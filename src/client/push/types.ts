export type SubscriptionContext = {
  type: 'CLIENT' | 'WORKER';
  phone?: string | null;
  registerNo?: string | null;
};

export type PushRegistrationResult =
  | { status: 'success'; token: string }
  | { status: 'denied'; message?: string; reason?: 'permission-denied' }
  | { status: 'unsupported'; message?: string; reason?: 'sdk-load-failed' | 'unsupported-browser' }
  | {
      status: 'error';
      message?: string;
      reason?: 'config-missing' | 'service-worker-failed' | 'token-failed' | 'sdk-load-failed';
    };
