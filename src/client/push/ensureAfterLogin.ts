import { registerWebPush, type SubscriptionContext } from './register';
import { buildPushContexts, hasPushCheckRun, markPushCheckRun, type PushIdentity } from './session';

const PUSH_CONSENT_MESSAGE =
  '청소목록 등 필수요소는 물론 업무 진행 상 유리하게 작용할 수 있는 여러가지 정보를 푸시알람으로 보내드리오니 꼭 허용하기 부탁 드립니다. 광고나 스팸성 푸시는 일절 전송되지 않습니다. 동의하시겠습니까?';

type PushStatusResponse = {
  client: boolean;
  worker: boolean;
  hasAnySubscription: boolean;
};

async function fetchSubscriptionStatus(): Promise<PushStatusResponse | null> {
  try {
    const response = await fetch('/api/push/status');
    if (!response.ok) {
      console.warn('푸시 구독 상태 확인 실패', response.statusText);
      return null;
    }

    return (await response.json()) as PushStatusResponse;
  } catch (error) {
    console.warn('푸시 구독 상태 확인 중 오류', error);
    return null;
  }
}

function logPartialFailures(label: string, result: Awaited<ReturnType<typeof registerWebPush>>) {
  if (result.status === 'success' && result.failures.length > 0) {
    console.warn(label, {
      successes: result.successes,
      failures: result.failures,
      skipped: result.skipped,
    });
  }
}

async function ensureWithPermission(contexts: SubscriptionContext[]) {
  const result = await registerWebPush(contexts);

  if (result.status === 'denied') {
    alert('알림 권한이 거부되어 푸시를 등록할 수 없습니다. 브라우저 설정을 확인해 주세요.');
    return;
  }

  if (result.status === 'unsupported' || result.status === 'error') {
    alert(result.message ?? '푸시 구독 처리 중 문제가 발생했습니다.');
    return;
  }

  logPartialFailures('일부 웹푸시 구독 저장 실패', result);
}

export async function ensurePushSubscription(identity: PushIdentity) {
  if (typeof window === 'undefined') return;

  const contexts = buildPushContexts(identity);
  if (contexts.length === 0) return;

  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || !(window as any).PushManager) {
    return;
  }

  if (hasPushCheckRun(identity)) {
    return;
  }

  const subscriptionStatus = await fetchSubscriptionStatus();

  try {
    const permission = Notification.permission;

    if (permission === 'granted') {
      const result = await registerWebPush(contexts);
      logPartialFailures('일부 웹푸시 구독 저장 실패', result);
      return;
    }

    if (permission === 'default') {
      const proceed = window.confirm(PUSH_CONSENT_MESSAGE);
      if (proceed) {
        await ensureWithPermission(contexts);
      }
      return;
    }

    const hasServerSubscription = subscriptionStatus?.hasAnySubscription;

    if (!hasServerSubscription) {
      alert(PUSH_CONSENT_MESSAGE);
      await ensureWithPermission(contexts);
    }
  } catch (error) {
    console.error('푸시 구독 강제 확인 중 오류', error);
  } finally {
    markPushCheckRun(identity);
  }
}

export { PUSH_CONSENT_MESSAGE };
