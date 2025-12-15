import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, pushSubscriptions, workerHeader } from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { normalizePhone } from '@/src/utils/phone';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UserContext = 'CLIENT' | 'WORKER';

type SubscribeRequest = {
  context: UserContext;
  endpoint: string;
  p256dh: string;
  auth: string;
  phone?: string | null;
  registerNo?: string | null;
  userAgent?: string | null;
  platform?: string | null;
  browser?: string | null;
  deviceId?: string | null;
  locale?: string | null;
};

function cleanString(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRegister(registerRaw: string | null | undefined) {
  const trimmed = cleanString(registerRaw);
  return trimmed ? trimmed.toUpperCase() : '';
}

function clamp(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function upsertSubscription(params: {
  userType: UserContext;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  platform?: string;
  browser?: string;
  deviceId?: string;
  locale?: string;
}) {
  const now = new Date();
  const userAgent = clamp(params.userAgent, 255);
  const platform = clamp(params.platform, 50);
  const browser = clamp(params.browser, 50);
  const deviceId = clamp(params.deviceId, 100);
  const locale = clamp(params.locale, 10);
  await db
    .insert(pushSubscriptions)
    .values({
      userType: params.userType,
      userId: params.userId,
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
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
        p256dh: params.p256dh,
        auth: params.auth,
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

export async function POST(request: Request) {
  let body: SubscribeRequest | null = null;

  try {
    body = (await request.json().catch(() => null)) as SubscribeRequest | null;
    if (!body) {
      return NextResponse.json({ message: '구독 정보가 필요합니다.' }, { status: 400 });
    }

    const context = body.context;
    if (context !== 'CLIENT' && context !== 'WORKER') {
      return NextResponse.json({ message: 'context는 CLIENT 또는 WORKER 여야 합니다.' }, { status: 400 });
    }

    const endpoint = cleanString(body.endpoint);
    const p256dh = cleanString(body.p256dh);
    const auth = cleanString(body.auth);

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ message: 'endpoint, p256dh, auth는 필수입니다.' }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(body.phone);
    const normalizedRegister = normalizeRegister(body.registerNo);

    if (context === 'CLIENT') {
      if (!normalizedPhone || !normalizedRegister) {
        return NextResponse.json({ message: 'CLIENT 구독에는 phone과 registerNo가 모두 필요합니다.' }, { status: 400 });
      }

      const [client] = await db
        .select({ id: clientHeader.id })
        .from(clientHeader)
        .where(and(eq(clientHeader.phone, normalizedPhone), eq(clientHeader.registerCode, normalizedRegister)))
        .limit(1);

      if (!client) {
        return NextResponse.json({ message: '일치하는 CLIENT를 찾을 수 없습니다.' }, { status: 404 });
      }

      await upsertSubscription({
        userType: 'CLIENT',
        userId: client.id,
        endpoint,
        p256dh,
        auth,
        userAgent: body.userAgent ?? undefined,
        platform: body.platform ?? undefined,
        browser: body.browser ?? undefined,
        deviceId: body.deviceId ?? undefined,
        locale: body.locale ?? undefined,
      });

      return NextResponse.json({ message: 'CLIENT 구독이 저장되었습니다.', userId: client.id });
    }

    if (!normalizedPhone && !normalizedRegister) {
      return NextResponse.json(
        { message: 'WORKER 구독에는 phone 또는 registerNo 중 하나가 필요합니다.' },
        { status: 400 }
      );
    }

    const [worker] = await db
      .select({ id: workerHeader.id })
      .from(workerHeader)
      .where(
        normalizedPhone
          ? eq(workerHeader.phone, normalizedPhone)
          : eq(workerHeader.registerCode, normalizedRegister)
      )
      .limit(1);

    if (!worker) {
      return NextResponse.json({ message: '일치하는 WORKER를 찾을 수 없습니다.' }, { status: 404 });
    }

    await upsertSubscription({
      userType: 'WORKER',
      userId: worker.id,
      endpoint,
      p256dh,
      auth,
      userAgent: body.userAgent ?? undefined,
      platform: body.platform ?? undefined,
      browser: body.browser ?? undefined,
      deviceId: body.deviceId ?? undefined,
      locale: body.locale ?? undefined,
    });

    return NextResponse.json({ message: 'WORKER 구독이 저장되었습니다.', userId: worker.id });
  } catch (error) {
    await logServerError({
      message: '푸시 구독 저장 실패',
      error,
      context: {
        context: 'subscribe',
        // Avoid persisting push keys in logs.
        body: { ...(body ?? {}), endpoint: undefined, p256dh: undefined, auth: undefined },
      },
    });
    return NextResponse.json({ message: '푸시 구독 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
