import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, pushSubscriptions, workerHeader } from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { normalizePhone } from '@/src/utils/phone';
import { getProfileSummary } from '@/src/utils/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeRegister(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.toUpperCase() : '';
}

async function hasClientSubscription(phone: string | null, registerNo: string) {
  if (!phone || !registerNo) return false;

  const [client] = await db
    .select({ id: clientHeader.id })
    .from(clientHeader)
    .where(and(eq(clientHeader.phone, phone), eq(clientHeader.registerCode, registerNo)))
    .limit(1);

  if (!client) return false;

  const [subscription] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userType, 'CLIENT'),
        eq(pushSubscriptions.userId, client.id),
        eq(pushSubscriptions.enabledYn, true)
      )
    )
    .limit(1);

  return Boolean(subscription);
}

async function hasWorkerSubscription(phone: string | null, registerNo: string) {
  if (!phone && !registerNo) return false;

  const [worker] = await db
    .select({ id: workerHeader.id })
    .from(workerHeader)
    .where(phone ? eq(workerHeader.phone, phone) : eq(workerHeader.registerCode, registerNo))
    .limit(1);

  if (!worker) return false;

  const [subscription] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userType, 'WORKER'),
        eq(pushSubscriptions.userId, worker.id),
        eq(pushSubscriptions.enabledYn, true)
      )
    )
    .limit(1);

  return Boolean(subscription);
}

export async function GET() {
  try {
    const profile = getProfileSummary();
    const phone = normalizePhone(profile.phone ?? '');
    const registerNo = normalizeRegister(profile.registerNo);

    const [client, worker] = await Promise.all([
      hasClientSubscription(phone, registerNo),
      hasWorkerSubscription(phone, registerNo),
    ]);

    const hasAnySubscription = client || worker;

    return NextResponse.json({
      client,
      worker,
      hasAnySubscription,
    });
  } catch (error) {
    await logServerError({
      appName: 'push-status',
      message: '푸시 구독 상태 조회 실패',
      error,
    });
    return NextResponse.json({ message: '푸시 구독 상태를 확인하지 못했습니다.' }, { status: 500 });
  }
}
