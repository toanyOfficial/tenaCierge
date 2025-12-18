import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { notifyJobs, pushMessageLogs, pushSubscriptions } from '@/src/db/schema';

export type NotifyJobRow = typeof notifyJobs.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export type NotifyJobPayload = {
  templateId: number;
  title: string;
  body: string;
  iconUrl?: string | null;
  clickUrl?: string | null;
  data?: Record<string, unknown>;
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
};

export type EnqueueNotifyJobParams = {
  ruleCode: string;
  userType: NotifyJobRow['userType'];
  userId: number;
  dedupKey: string;
  payload: NotifyJobPayload;
  scheduledAt?: Date;
  createdBy?: string;
};

function maskToken(token: string) {
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function maskFingerprint(fingerprint?: string | null) {
  if (!fingerprint) return fingerprint ?? undefined;
  return fingerprint.length > 8 ? `${fingerprint.slice(0, 4)}...${fingerprint.slice(-4)}` : fingerprint;
}

export async function enqueueNotifyJob(params: EnqueueNotifyJobParams) {
  const scheduledAt = params.scheduledAt ?? new Date();

  try {
    const result = await db
      .insert(notifyJobs)
      .values({
        ruleCode: params.ruleCode,
        userType: params.userType,
        userId: params.userId,
        scheduledAt,
        dedupKey: params.dedupKey,
        payloadJson: params.payload,
        createdBy: params.createdBy,
      })
      .execute();

    const insertId = Array.isArray(result)
      ? result[0]?.insertId
      : (result as { insertId?: unknown }).insertId;

    return { created: true, jobId: Number(insertId) } as const;
  } catch (error) {
    const isDup = typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';
    if (isDup) {
      return { created: false } as const;
    }
    throw error;
  }
}

export async function fetchReadyJobs(limit = 50) {
  // NOTE:
  // scheduled_at is stored as KST (DATETIME).
  // DB NOW() is UTC, so we must compare against KST-adjusted NOW()
  // to avoid missing due notification jobs.
  return db
    .select()
    .from(notifyJobs)
    .where(and(eq(notifyJobs.status, 'READY'), sql`${notifyJobs.scheduledAt} <= CONVERT_TZ(NOW(), '+00:00', '+09:00')`))
    .orderBy(notifyJobs.scheduledAt)
    .limit(limit);
}

export async function lockJobs(jobIds: number[], lockedBy: string) {
  if (jobIds.length === 0) return 0;

  const result = await db
    .update(notifyJobs)
    .set({
      status: 'LOCKED',
      lockedBy,
      lockedAt: new Date(),
      tryCount: sql`try_count + 1`,
    })
    .where(and(inArray(notifyJobs.id, jobIds), eq(notifyJobs.status, 'READY')))
    .execute();

  return Number(result[0]?.affectedRows ?? 0);
}

export async function markJobDone(jobId: number) {
  await db
    .update(notifyJobs)
    .set({ status: 'DONE', lastError: null, lockedAt: null, lockedBy: null })
    .where(eq(notifyJobs.id, jobId));
}

export async function markJobFailed(jobId: number, errorMessage: string) {
  const trimmed = errorMessage.slice(0, 255);
  await db
    .update(notifyJobs)
    .set({ status: 'FAILED', lastError: trimmed })
    .where(eq(notifyJobs.id, jobId));
}

export async function fetchEnabledSubscriptions(userType: PushSubscriptionRow['userType'], userId: number) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userType, userType), eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.enabledYn, true)));
}

export type DeliverResult = {
  status: 'SENT' | 'FAILED' | 'EXPIRED';
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  sentAt?: Date;
  disableSubscription?: boolean;
  disableReason?: string;
};

export type DeliverFn = (
  subscription: PushSubscriptionRow,
  payload: NotifyJobPayload,
  job: NotifyJobRow
) => Promise<DeliverResult>;

export async function logPushAttempt(params: {
  jobId: number;
  subscriptionId: number;
  result: DeliverResult;
}) {
  await db.insert(pushMessageLogs).values({
    notifyJobId: params.jobId,
    subscriptionId: params.subscriptionId,
    status: params.result.status,
    httpStatus: params.result.httpStatus,
    errorCode: params.result.errorCode,
    errorMessage: params.result.errorMessage,
    sentAt: params.result.sentAt,
  });
}

export async function processLockedJob(job: NotifyJobRow, deliver: DeliverFn) {
  const payload = job.payloadJson as NotifyJobPayload;
  const subscriptions = await fetchEnabledSubscriptions(job.userType, job.userId);

  if (!subscriptions.length) {
    await markJobDone(job.id);
    return { jobId: job.id, sent: 0, failed: 0, skipped: true } as const;
  }

  let sent = 0;
  let failed = 0;
  let firstFailureDetail: string | null = null;

  console.info('[web-push] delivery targets', {
    jobId: job.id,
    userType: job.userType,
    userId: job.userId,
    subscriptionCount: subscriptions.length,
  });

  for (const subscription of subscriptions) {
    try {
      const result = await deliver(subscription, payload, job);
      if (result.disableSubscription) {
        await db
          .update(pushSubscriptions)
          .set({ enabledYn: false, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(pushSubscriptions.id, subscription.id));
        console.warn('[push] subscription disabled after failure', {
          subscriptionId: subscription.id,
          jobId: job.id,
          userType: subscription.userType,
          userId: subscription.userId,
          httpStatus: result.httpStatus,
          errorCode: result.errorCode,
          disableReason: result.disableReason,
          deviceFingerprint: maskFingerprint(subscription.deviceFingerprint),
          token: maskToken(subscription.endpoint),
        });
      }
      await logPushAttempt({ jobId: job.id, subscriptionId: subscription.id, result });
      if (result.status === 'SENT') {
        sent += 1;
      } else {
        failed += 1;
        if (!firstFailureDetail) {
          const parts = [] as string[];
          if (result.httpStatus) parts.push(`status=${result.httpStatus}`);
          if (result.errorMessage) parts.push(result.errorMessage);
          parts.push(`token=${maskToken(subscription.endpoint)}`);
          const maskedFingerprint = maskFingerprint(subscription.deviceFingerprint);
          if (maskedFingerprint) parts.push(`device=${maskedFingerprint}`);
          firstFailureDetail = parts.join(' ');
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : 'unexpected delivery error';
      await logPushAttempt({
        jobId: job.id,
        subscriptionId: subscription.id,
        result: { status: 'FAILED', errorMessage: message },
      });
      if (!firstFailureDetail) {
        const maskedFingerprint = maskFingerprint(subscription.deviceFingerprint);
        const maskedToken = maskToken(subscription.endpoint);
        firstFailureDetail = `error=${message} token=${maskedToken}${maskedFingerprint ? ` device=${maskedFingerprint}` : ''}`;
      }
    }
  }

  if (failed === 0) {
    await markJobDone(job.id);
  } else {
    const detail = firstFailureDetail ? `; first failure ${firstFailureDetail}` : '';
    await markJobFailed(job.id, `delivery failed (${failed}/${subscriptions.length})${detail}`);
  }

  return { jobId: job.id, sent, failed, skipped: false } as const;
}

export async function runDueJobs(deliver: DeliverFn, options?: { limit?: number; lockedBy?: string }) {
  const limit = options?.limit ?? 50;
  const lockedBy = options?.lockedBy ?? 'webpush-worker';

  const ready = await fetchReadyJobs(limit);
  if (!ready.length) {
    return [] as Array<{ jobId: number; sent: number; failed: number; skipped: boolean }>;
  }

  const lockedCount = await lockJobs(ready.map((job) => job.id), lockedBy);
  if (lockedCount === 0) {
    return [] as Array<{ jobId: number; sent: number; failed: number; skipped: boolean }>;
  }

  const lockedJobs = await db
    .select()
    .from(notifyJobs)
    .where(and(eq(notifyJobs.status, 'LOCKED'), inArray(notifyJobs.id, ready.map((job) => job.id))));

  const results: Array<{ jobId: number; sent: number; failed: number; skipped: boolean }> = [];
  for (const job of lockedJobs) {
    const result = await processLockedJob(job, deliver);
    results.push(result);
  }

  return results;
}
