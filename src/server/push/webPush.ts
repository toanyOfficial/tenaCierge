import { GoogleAuth } from 'google-auth-library';

import {
  type DeliverFn,
  type DeliverResult,
  type NotifyJobPayload,
  type PushSubscriptionRow,
  runDueJobs
} from '@/src/server/push/jobs';

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_URGENCY: NotifyJobPayload['urgency'] = 'normal';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects';

type AccessContext = {
  client: Awaited<ReturnType<GoogleAuth['getClient']>>;
  projectId: string;
};

const auth = new GoogleAuth({ scopes: [FCM_SCOPE] });
let cachedAccessContext: Promise<AccessContext> | null = null;

async function getAccessContext() {
  if (!cachedAccessContext) {
    cachedAccessContext = (async () => {
      const [client, projectId] = await Promise.all([auth.getClient(), auth.getProjectId()]);
      if (!projectId) {
        throw new Error('프로젝트 ID를 확인할 수 없습니다. GOOGLE_APPLICATION_CREDENTIALS 설정을 확인해 주세요.');
      }
      return { client, projectId } satisfies AccessContext;
    })();
  }

  return cachedAccessContext;
}

async function getAccessToken(client: AccessContext['client']) {
  const token = await client.getAccessToken();
  if (!token) {
    throw new Error('FCM 액세스 토큰을 발급하지 못했습니다.');
  }

  return typeof token === 'string' ? token : token.token;
}

function buildDataPayload(payload: NotifyJobPayload, dedupKey: string) {
  const data: Record<string, string> = {
    templateId: String(payload.templateId),
    title: payload.title,
    body: payload.body,
    clickUrl: payload.clickUrl ?? '',
    iconUrl: payload.iconUrl ?? '',
    dedupKey
  };

  if (payload.data) {
    data.data = JSON.stringify(payload.data);
  }

  return data;
}

function buildWebpushConfig(payload: NotifyJobPayload) {
  const headers: Record<string, string> = {};
  const ttl = payload.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (ttl) {
    headers.TTL = String(ttl);
  }

  const urgency = payload.urgency ?? DEFAULT_URGENCY;
  if (urgency) {
    headers.Urgency = urgency;
  }

  const notification: Record<string, string> = {};
  if (payload.iconUrl) {
    notification.icon = payload.iconUrl;
  }

  const fcmOptions: Record<string, string> = {};
  if (payload.clickUrl) {
    fcmOptions.link = payload.clickUrl;
  }

  const webpush: Record<string, unknown> = {};
  if (Object.keys(headers).length) {
    webpush.headers = headers;
  }
  if (Object.keys(notification).length) {
    webpush.notification = notification;
  }
  if (Object.keys(fcmOptions).length) {
    webpush.fcm_options = fcmOptions;
  }

  return webpush;
}

function buildFcmMessage(payload: NotifyJobPayload, subscription: PushSubscriptionRow, dedupKey: string) {
  const message: Record<string, unknown> = {
    token: subscription.endpoint,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.iconUrl ? { icon: payload.iconUrl } : {})
    },
    data: buildDataPayload(payload, dedupKey)
  };

  const webpush = buildWebpushConfig(payload);
  if (Object.keys(webpush).length) {
    message.webpush = webpush;
  }

  return { message };
}

function toDeliverResult(httpStatus: number | undefined, errorMessage: string): DeliverResult {
  const expired = httpStatus === 404 || httpStatus === 410;
  return {
    status: expired ? 'EXPIRED' : 'FAILED',
    httpStatus,
    errorMessage: errorMessage.slice(0, 255)
  } satisfies DeliverResult;
}

export function createWebPushDeliver(): DeliverFn {
  return async (subscription, payload, job) => {
    try {
      const { client, projectId } = await getAccessContext();
      const accessToken = await getAccessToken(client);
      if (!accessToken) {
        return { status: 'FAILED', errorMessage: 'FCM 액세스 토큰을 발급하지 못했습니다.' } satisfies DeliverResult;
      }

      const url = `${FCM_ENDPOINT}/${projectId}/messages:send`;
      const fcmMessage = buildFcmMessage(payload, subscription, job.dedupKey);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fcmMessage)
      });

      const responseBody = await response.text();
      console.info('[web-push] fcm response', { status: response.status, body: responseBody });

      if (response.ok) {
        return { status: 'SENT', sentAt: new Date(), httpStatus: response.status } satisfies DeliverResult;
      }

      return toDeliverResult(response.status, responseBody || `HTTP ${response.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unexpected fcm error';
      console.error('[web-push] fcm error', { message });
      return { status: 'FAILED', errorMessage: message.slice(0, 255) } satisfies DeliverResult;
    }
  };
}

export async function runWebPushWorker(options?: { limit?: number; lockedBy?: string }) {
  const deliver = createWebPushDeliver();
  return runDueJobs(deliver, {
    limit: options?.limit,
    lockedBy: options?.lockedBy ?? 'webpush-worker'
  });
}
