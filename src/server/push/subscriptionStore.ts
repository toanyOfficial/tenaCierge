import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { pushSubscriptions } from '@/src/db/schema';

const FCM_HOST_KEYWORD = 'fcm.googleapis.com';
const LEGACY_PREFIX = 'https://fcm.googleapis.com/fcm/send/';

export function normalizeToken(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith(LEGACY_PREFIX)) {
    return trimmed.slice(LEGACY_PREFIX.length);
  }
  return trimmed;
}

export function isInvalidTokenFormat(token: string) {
  const lowered = token.toLowerCase();
  return lowered.includes('http://') || lowered.includes('https://') || lowered.includes(FCM_HOST_KEYWORD);
}

export async function upsertSubscription(params: {
  userType: 'CLIENT' | 'WORKER';
  userId: number;
  token: string;
  userAgent?: string;
  platform?: string;
  browser?: string;
  deviceId?: string;
  locale?: string;
}) {
  const now = new Date();
  const token = normalizeToken(params.token);
  const userAgent = params.userAgent?.slice(0, 255);
  const platform = params.platform?.slice(0, 50);
  const browser = params.browser?.slice(0, 50);
  const deviceId = params.deviceId?.slice(0, 100);
  const locale = params.locale?.slice(0, 10);

  await db
    .insert(pushSubscriptions)
    .values({
      userType: params.userType,
      userId: params.userId,
      endpoint: token,
      p256dh: '',
      auth: '',
      enabledYn: true,
      lastSeenAt: now,
      userAgent,
      platform,
      browser,
      deviceId,
      locale,
    })
    .onDuplicateKeyUpdate({
      set: {
        endpoint: token,
        p256dh: '',
        auth: '',
        enabledYn: true,
        lastSeenAt: now,
        userAgent,
        platform,
        browser,
        deviceId,
        locale,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

export async function disableSubscription(id: number, reason?: string) {
  await db
    .update(pushSubscriptions)
    .set({ enabledYn: false, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(pushSubscriptions.id, id));

  if (reason) {
    console.warn('[push] disable subscription', { id, reason });
  }
}

export async function normalizeStoredEndpoint(subscriptionId: number, endpoint: string) {
  const normalized = normalizeToken(endpoint);
  if (normalized === endpoint) return endpoint;

  await db
    .update(pushSubscriptions)
    .set({ endpoint: normalized, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(pushSubscriptions.id, subscriptionId), eq(pushSubscriptions.endpoint, endpoint)));

  return normalized;
}
