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

function normalizeFingerprint(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('device fingerprint is required');
  }
  return trimmed.slice(0, 128);
}

function maskToken(token: string) {
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function maskFingerprint(fingerprint: string) {
  if (fingerprint.length <= 8) return fingerprint;
  return `${fingerprint.slice(0, 4)}...${fingerprint.slice(-4)}`;
}

export function isInvalidTokenFormat(token: string) {
  const lowered = token.toLowerCase();
  return lowered.includes('http://') || lowered.includes('https://') || lowered.includes(FCM_HOST_KEYWORD);
}

export async function upsertSubscription(params: {
  userType: 'CLIENT' | 'WORKER';
  userId: number;
  token: string;
  deviceFingerprint: string;
  userAgent?: string;
  platform?: string;
  browser?: string;
  deviceId?: string;
  locale?: string;
}) {
  const now = new Date();
  const token = normalizeToken(params.token);
  const fingerprint = normalizeFingerprint(params.deviceFingerprint);
  const userAgent = params.userAgent?.slice(0, 255);
  const platform = params.platform?.slice(0, 50);
  const browser = params.browser?.slice(0, 50);
  const deviceId = params.deviceId?.slice(0, 100);
  const locale = params.locale?.slice(0, 10);

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userType, params.userType),
          eq(pushSubscriptions.userId, params.userId),
          eq(pushSubscriptions.deviceFingerprint, fingerprint),
          eq(pushSubscriptions.enabledYn, true)
        )
      );

    if (existing.length > 0) {
      await tx
        .update(pushSubscriptions)
        .set({ enabledYn: false, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(pushSubscriptions.userType, params.userType),
            eq(pushSubscriptions.userId, params.userId),
            eq(pushSubscriptions.deviceFingerprint, fingerprint),
            eq(pushSubscriptions.enabledYn, true)
          )
        );

      existing.forEach((row) => {
        console.info('[push] disable prior device token', {
          userType: params.userType,
          userId: params.userId,
          deviceFingerprint: maskFingerprint(fingerprint),
          token: maskToken(row.endpoint),
          reason: 'device-replacement',
        });
      });
    }

    await tx
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
        deviceFingerprint: fingerprint,
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
          deviceFingerprint: fingerprint,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
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
