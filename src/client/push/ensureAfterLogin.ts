import { registerFcmSubscriptions, type RegisterResult } from './register';
import type { PushIdentity } from './session';
import {
  buildPushContexts,
  clearPushSession,
  getLastPushState,
  markPushDenied,
  markPushPrompted,
  markPushSuccess,
  resetPushSessionFlags,
  shouldRetry,
} from './session';

const PUSH_CONSENT_MESSAGE =
  '청소목록 등 필수요소는 물론 업무 진행 상 유리하게 작용할 수 있는 여러가지 정보를 푸시알람으로 보내드리오니 꼭 허용하기 부탁 드립니다. 광고나 스팸성 푸시는 일절 전송되지 않습니다. 동의하시겠습니까?';

const RETRY_EVENTS = ['visibilitychange', 'focus', 'pageshow'] as const;
let listenersBound = false;
let latestRunner: (() => void) | null = null;

async function fetchSubscriptionStatus() {
  try {
    const response = await fetch('/api/push/subscriptions/me');
    if (!response.ok) {
      console.warn('푸시 구독 상태 확인 실패', response.statusText);
      return null;
    }

    return (await response.json()) as { hasAnySubscription: boolean; client: boolean; worker: boolean };
  } catch (error) {
    console.warn('푸시 구독 상태 확인 중 오류', error);
    return null;
  }
}

function logPartialFailures(label: string, result: RegisterResult) {
  if (result.status === 'success' && result.failures.length > 0) {
    console.warn(label, {
      successes: result.successes,
      failures: result.failures,
      skipped: result.skipped,
      reasons: result.failureReasons,
    });
  }
}

async function persistWithToken(contexts: ReturnType<typeof buildPushContexts>) {
  const result = await registerFcmSubscriptions(contexts);

  if (result.status === 'denied') {
    return { outcome: 'denied', message: result.message } as const;
  }

  if (result.status === 'unsupported' || result.status === 'error') {
    console.warn('푸시 구독 처리 실패', result.message);
    return { outcome: 'error', message: result.message } as const;
  }

  if (result.status === 'skipped') {
    return { outcome: 'skipped', message: result.message } as const;
  }

  logPartialFailures('일부 푸시 구독 저장 실패', result);
  return { outcome: 'success' as const };
}

function bindRetry(runner: () => void) {
  if (typeof window === 'undefined') return;
  latestRunner = runner;

  if (listenersBound) return;

  RETRY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, () => {
      latestRunner?.();
    });
  });

  listenersBound = true;
}

async function runEnforcement(identity: PushIdentity) {
  if (typeof window === 'undefined') return;

  const contexts = buildPushContexts(identity);
  if (contexts.length === 0) return;

  const subscriptionStatus = await fetchSubscriptionStatus();
  const hasServerSubscription = subscriptionStatus?.hasAnySubscription ?? false;

  try {
    const permission = Notification.permission;

    if (permission === 'granted') {
      const result = await persistWithToken(contexts);
      if (result.outcome === 'success') {
        markPushSuccess(identity);
      }
      return;
    }

    if (permission === 'default') {
      const lastState = getLastPushState(identity);
      if (!hasServerSubscription || lastState?.status !== 'prompted') {
        const proceed = window.confirm(PUSH_CONSENT_MESSAGE);
        markPushPrompted(identity);
        if (proceed) {
          const permissionResult = await Notification.requestPermission();
          if (permissionResult === 'granted') {
            const result = await persistWithToken(contexts);
            if (result.outcome === 'success') {
              markPushSuccess(identity);
            }
          } else {
            markPushDenied(identity);
          }
        }
      }
      return;
    }

    if (permission === 'denied') {
      if (!hasServerSubscription) {
        alert('브라우저 알림이 차단되어 있습니다. 알림을 받으려면 브라우저 설정에서 알림을 허용해 주세요.');
      }
      markPushDenied(identity);
    }
  } catch (error) {
    console.error('푸시 구독 강제 확인 중 오류', error);
  }
}

export async function ensurePushSubscription(identity: PushIdentity) {
  if (typeof window === 'undefined') return;
  if (!shouldRetry(identity)) return;

  const runner = () => {
    if (shouldRetry(identity)) {
      void runEnforcement(identity);
    }
  };

  bindRetry(runner);
  await runEnforcement(identity);
}

export { PUSH_CONSENT_MESSAGE, resetPushSessionFlags, clearPushSession };
