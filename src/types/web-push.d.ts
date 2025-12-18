declare module 'web-push' {
  export type PushSubscription = {
    endpoint: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };

  export type VapidDetails = {
    subject: string;
    publicKey: string;
    privateKey: string;
  };

  export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

  export type RequestOptions = {
    TTL?: number;
    urgency?: Urgency;
    topic?: string;
    vapidDetails?: VapidDetails;
    proxy?: string;
    headers?: Record<string, string>;
  };

  export type SendResult = {
    statusCode: number;
    body?: string;
    headers?: Record<string, string>;
  };

  export class WebPushError extends Error {
    statusCode?: number;
    body?: string;
    headers?: Record<string, string>;
    endpoint?: string;
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function setGCMAPIKey(apiKey: string): void;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer,
    options?: RequestOptions
  ): Promise<SendResult>;
}
