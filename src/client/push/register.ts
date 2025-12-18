import { getDeviceFingerprint } from './device';
import { obtainFcmToken } from './fcm';
import type { SubscriptionContext } from './types';

type RegistrationFailureReason =
  | 'config-missing'
  | 'service-worker-failed'
  | 'token-failed'
  | 'sdk-load-failed'
  | 'unsupported-browser'
  | 'permission-denied'
  | 'fingerprint-missing'
  | undefined;

export type PersistResult = {
  successes: string[];
  failures: string[];
  skipped: string[];
  failureReasons?: Record<string, string>;
};

export type RegisterResult =
  | ({ status: 'success' } & PersistResult & { token: string })
  | { status: 'skipped'; message: string }
  | { status: 'unsupported'; message: string; reason?: RegistrationFailureReason }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string; reason?: RegistrationFailureReason };

function buildBrowserLabel() {
  if (typeof navigator === 'undefined') return '';
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData
    ?.brands;
  if (!brands || !brands.length) return navigator.userAgent;
  return brands.map((entry) => `${entry.brand}/${entry.version}`).join(', ');
}

async function persistToken(
  contexts: SubscriptionContext[],
  token: string,
  metadata?: {
    userAgent?: string;
    platform?: string;
    browser?: string;
    deviceId?: string;
    locale?: string;
    deviceFingerprint?: string;
  }
): Promise<PersistResult> {
  const successes: string[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];
  const failureReasons: Record<string, string> = {};

  for (const ctx of contexts) {
    const label = `${ctx.type}-${ctx.registerNo ?? ctx.phone ?? 'unknown'}`;

    if (ctx.type === 'CLIENT' && (!ctx.phone || !ctx.registerNo)) {
      skipped.push(label);
      continue;
    }

    if (ctx.type === 'WORKER' && !ctx.phone && !ctx.registerNo) {
      skipped.push(label);
      continue;
    }

    try {
      const response = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: ctx.type,
          token,
          phone: ctx.phone ?? null,
          registerNo: ctx.registerNo ?? null,
          userAgent: metadata?.userAgent,
          platform: metadata?.platform,
          browser: metadata?.browser,
          deviceId: metadata?.deviceId,
          deviceFingerprint: metadata?.deviceFingerprint,
          locale: metadata?.locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined),
        }),
      });

      if (!response.ok) {
        failures.push(label);
        const errorBody = await response.json().catch(() => null);
        const message =
          (errorBody && typeof errorBody === 'object' && 'message' in errorBody && typeof (errorBody as any).message === 'string'
            ? (errorBody as any).message
            : null) || response.statusText || '구독 저장 요청이 실패했습니다.';
        failureReasons[label] = message;
      } else {
        successes.push(label);
      }
    } catch (error) {
      failures.push(label);
      failureReasons[label] = error instanceof Error ? error.message : '알 수 없는 오류로 구독을 저장하지 못했습니다.';
    }
  }

  return { successes, failures, skipped, failureReasons };
}

export async function registerFcmSubscriptions(contexts: SubscriptionContext[]): Promise<RegisterResult> {
  if (typeof window === 'undefined') {
    return { status: 'unsupported', message: '브라우저 환경에서만 푸시를 등록할 수 있습니다.' };
  }

  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') {
    return { status: 'unsupported', message: '브라우저가 푸시를 지원하지 않습니다.' };
  }

  const readyContexts = contexts.filter((ctx) => {
    if (ctx.type === 'CLIENT') {
      return Boolean(ctx.phone && ctx.registerNo);
    }
    return Boolean(ctx.phone || ctx.registerNo);
  });

  if (readyContexts.length === 0) {
    return { status: 'skipped', message: '푸시 구독에 필요한 식별자가 없습니다.' };
  }

  const permission = Notification.permission;
  if (permission === 'denied') {
    return { status: 'denied', message: '알림 권한이 거부되어 있습니다.' };
  }

  const [fingerprint, tokenResult] = await Promise.all([getDeviceFingerprint(), obtainFcmToken()]);

  if (!fingerprint) {
    return {
      status: 'error',
      reason: 'fingerprint-missing',
      message: '디바이스를 식별할 수 없어 푸시 알림을 활성화하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    };
  }

  if (tokenResult.status === 'denied') {
    return { status: 'denied', message: tokenResult.message ?? '알림 권한이 거부되었습니다.' };
  }

  if (tokenResult.status === 'unsupported' || tokenResult.status === 'error') {
    return {
      status: tokenResult.status,
      message: tokenResult.message ?? '푸시를 지원하지 않는 환경입니다.',
      reason: tokenResult.reason,
    } as const;
  }

  const metadata = {
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform,
    browser: buildBrowserLabel(),
    deviceId: (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      ? `${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}GB`
      : undefined,
    locale: navigator.language,
    deviceFingerprint: fingerprint,
  };

  try {
    const { successes, failures, skipped, failureReasons } = await persistToken(readyContexts, tokenResult.token, metadata);
    const hasFailure = failures.length > 0;
    const hasSuccess = successes.length > 0;

    if (hasSuccess) {
      return { status: 'success', token: tokenResult.token, successes, failures, skipped, failureReasons };
    }

    if (hasFailure) {
      const primaryLabel = failures[0];
      const reason = primaryLabel ? failureReasons?.[primaryLabel] : null;
      return { status: 'error', message: reason ?? '푸시 구독 저장에 실패했습니다. 다시 시도해 주세요.' };
    }

    return { status: 'skipped', message: '푸시 구독에 필요한 식별자가 없습니다.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '푸시 구독 처리 중 오류가 발생했습니다.' };
  }
}
