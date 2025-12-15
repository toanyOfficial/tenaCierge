export type SubscriptionContext = {
  type: 'CLIENT' | 'WORKER';
  phone?: string | null;
  registerNo?: string | null;
};

export type RegisterResult =
  | { status: 'success'; message?: string; successes: string[]; failures: string[]; skipped: string[] }
  | { status: 'skipped'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function bufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function buildBrowserLabel() {
  if (typeof navigator === 'undefined') return '';
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData?.brands;
  if (!brands || !brands.length) return navigator.userAgent;
  return brands.map((entry) => `${entry.brand}/${entry.version}`).join(', ');
}

async function getSubscription(applicationServerKey: Uint8Array) {
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });
}

async function persistSubscription(
  contexts: SubscriptionContext[],
  subscription: PushSubscription,
  metadata?: { userAgent?: string; platform?: string; browser?: string; deviceId?: string; locale?: string }
) {
  const successes: string[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];

  const p256dh = bufferToBase64(subscription.getKey('p256dh'));
  const auth = bufferToBase64(subscription.getKey('auth'));

  if (!p256dh || !auth) {
    throw new Error('브라우저 구독 키를 읽을 수 없습니다. 권한을 다시 요청해 주세요.');
  }

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
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: ctx.type,
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          phone: ctx.phone ?? null,
          registerNo: ctx.registerNo ?? null,
          userAgent: metadata?.userAgent,
          platform: metadata?.platform,
          browser: metadata?.browser,
          deviceId: metadata?.deviceId,
          locale: metadata?.locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined)
        })
      });

      if (!response.ok) {
        failures.push(label);
      } else {
        successes.push(label);
      }
    } catch (error) {
      failures.push(label);
    }
  }

  return { successes, failures, skipped };
}

export async function registerWebPush(contexts: SubscriptionContext[]): Promise<RegisterResult> {
  if (typeof window === 'undefined') {
    return { status: 'unsupported', message: '브라우저 환경에서만 푸시를 등록할 수 있습니다.' };
  }

  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || !(window as any).PushManager) {
    return { status: 'unsupported', message: '브라우저가 웹푸시를 지원하지 않습니다.' };
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

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { status: 'error', message: 'VAPID 공개키가 설정되지 않았습니다.' };
  }

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();

  if (permission !== 'granted') {
    return { status: 'denied', message: '알림 권한이 허용되지 않았습니다.' };
  }

  const subscription = await getSubscription(urlBase64ToUint8Array(vapidKey));
  const metadata = {
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform,
    browser: buildBrowserLabel(),
    deviceId: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ? `${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}GB` : undefined,
    locale: navigator.language
  };

  try {
    const { successes, failures, skipped } = await persistSubscription(readyContexts, subscription, metadata);
    const hasFailure = failures.length > 0;

    return {
      status: hasFailure && successes.length === 0 ? 'error' : 'success',
      message: hasFailure
        ? '일부 구독 저장에 실패했습니다. 다시 시도해 주세요.'
        : '푸시 구독이 저장되었습니다.',
      successes,
      failures,
      skipped
    };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '푸시 구독 처리 중 오류가 발생했습니다.' };
  }
}
