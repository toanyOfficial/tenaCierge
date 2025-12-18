export type SubscriptionContext = {
  type: 'CLIENT' | 'WORKER';
  phone?: string | null;
  registerNo?: string | null;
};

export type PushRegistrationResult =
  | { status: 'success'; token: string }
  | { status: 'denied'; message?: string }
  | { status: 'unsupported'; message?: string }
  | { status: 'error'; message?: string };
