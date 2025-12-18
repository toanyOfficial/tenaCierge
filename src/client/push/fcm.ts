import type { PushRegistrationResult } from './types';

type FirebaseModules = {
  initializeApp: (config: Record<string, unknown>) => unknown;
  getApps: () => unknown[];
  getMessaging: (app?: unknown) => unknown;
  getToken: (messaging: unknown, options: { vapidKey?: string; serviceWorkerRegistration?: ServiceWorkerRegistration }) => Promise<string | null>;
  isSupported: () => Promise<boolean>;
};

let firebaseModulesPromise: Promise<FirebaseModules> | null = null;

async function loadFirebaseModules(): Promise<FirebaseModules> {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = (async () => {
      // @ts-expect-error remote firebase bundle is loaded at runtime
      const appModule = (await import(/* webpackIgnore: true */ 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js')) as any;
      // @ts-expect-error remote firebase bundle is loaded at runtime
      const messagingModule = (await import(/* webpackIgnore: true */ 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js')) as any;
      return {
        initializeApp: appModule.initializeApp,
        getApps: appModule.getApps,
        getMessaging: messagingModule.getMessaging,
        getToken: messagingModule.getToken,
        isSupported: messagingModule.isSupported,
      };
    })();
  }

  return firebaseModulesPromise;
}

function getFirebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    throw new Error('Firebase 웹 설정이 누락되었습니다. 환경변수를 확인해 주세요.');
  }

  return {
    apiKey,
    authDomain,
    projectId,
    messagingSenderId,
    appId,
    ...(measurementId ? { measurementId } : {}),
  };
}

async function ensureApp(modules: FirebaseModules) {
  const existing = modules.getApps()[0];
  if (existing) return existing;
  const config = getFirebaseConfig();
  return modules.initializeApp(config);
}

export async function obtainFcmToken(): Promise<PushRegistrationResult> {
  if (typeof window === 'undefined') {
    return { status: 'unsupported', message: '브라우저 환경에서만 지원됩니다.' };
  }

  let modules: FirebaseModules;
  try {
    modules = await loadFirebaseModules();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FCM 스크립트를 불러오지 못했습니다.';
    return { status: 'unsupported', message };
  }

  try {
    const supported = await modules.isSupported();
    if (!supported) {
      return { status: 'unsupported', message: '이 브라우저에서는 푸시 알림을 지원하지 않습니다.' };
    }
  } catch (error) {
    console.warn('FCM 지원 여부 확인 실패', error);
    return { status: 'unsupported', message: '이 브라우저에서는 푸시 알림을 지원하지 않습니다.' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/push-sw.js');
    const app = await ensureApp(modules);
    const messaging = modules.getMessaging(app);
    const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
    const token = await modules.getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return { status: 'error', message: 'FCM 토큰을 발급하지 못했습니다.' };
    }

    return { status: 'success', token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FCM 토큰 발급 중 오류가 발생했습니다.';
    return { status: 'error', message };
  }
}
