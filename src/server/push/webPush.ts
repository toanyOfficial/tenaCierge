import type { PushSubscription as WebPushSubscription, SendResult, WebPushError } from 'web-push';

import { loadVapidConfig, type VapidConfig } from '@/src/server/push/env';
import {
  type DeliverFn,
  type DeliverResult,
  type NotifyJobPayload,
  type PushSubscriptionRow,
  runDueJobs
} from '@/src/server/push/jobs';

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_URGENCY: NotifyJobPayload['urgency'] = 'normal';

let cachedWebPush: Promise<typeof import('web-push')> | null = null;

function toWebPushSubscription(subscription: PushSubscriptionRow): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };
}

function buildPayload(payload: NotifyJobPayload, dedupKey: string) {
  return JSON.stringify({
    templateId: payload.templateId,
    title: payload.title,
    body: payload.body,
    iconUrl: payload.iconUrl,
    clickUrl: payload.clickUrl,
    data: payload.data,
    dedupKey
  });
}

function buildSendOptions(payload: NotifyJobPayload) {
  return {
    TTL: payload.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    urgency: payload.urgency ?? DEFAULT_URGENCY
  } satisfies Parameters<typeof import('web-push')['sendNotification']>[2];
}

function isWebPushError(error: unknown): error is WebPushError {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

function toDeliverResult(error: unknown): DeliverResult {
  if (isWebPushError(error)) {
    const expired = error.statusCode === 404 || error.statusCode === 410;
    const message = error.body || error.message || 'web push error';
    return {
      status: expired ? 'EXPIRED' : 'FAILED',
      httpStatus: error.statusCode,
      errorMessage: message.slice(0, 255)
    };
  }

  const fallback = error instanceof Error ? error.message : 'unexpected web push error';
  return { status: 'FAILED', errorMessage: fallback.slice(0, 255) };
}

async function loadWebPush(vapid: VapidConfig) {
  if (!cachedWebPush) {
    cachedWebPush = import('web-push');
  }

  const webPush = await cachedWebPush.catch((error: unknown) => {
    cachedWebPush = null;
    const reason = error instanceof Error ? error.message : 'unknown';
    throw new Error(`web-push 모듈을 불러올 수 없습니다. npm install web-push 후 다시 실행하세요. (${reason})`);
  });

  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return webPush;
}

export function createWebPushDeliver(vapidConfig?: VapidConfig): DeliverFn {
  const config = vapidConfig ?? loadVapidConfig();

  return async (subscription, payload, job) => {
    const webPush = await loadWebPush(config);
    const body = buildPayload(payload, job.dedupKey);
    const options = buildSendOptions(payload);

    try {
      const result: SendResult = await webPush.sendNotification(toWebPushSubscription(subscription), body, options);
      return { status: 'SENT', sentAt: new Date(), httpStatus: result.statusCode } satisfies DeliverResult;
    } catch (error) {
      return toDeliverResult(error);
    }
  };
}

export async function runWebPushWorker(options?: {
  limit?: number;
  lockedBy?: string;
  vapid?: VapidConfig;
}) {
  const deliver = createWebPushDeliver(options?.vapid);
  return runDueJobs(deliver, {
    limit: options?.limit,
    lockedBy: options?.lockedBy ?? 'webpush-worker'
  });
}
