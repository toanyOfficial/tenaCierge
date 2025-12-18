import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, workerHeader } from '@/src/db/schema';
import { logEtcError, logServerError } from '@/src/server/errorLogger';
import { isInvalidTokenFormat, normalizeToken, upsertSubscription } from '@/src/server/push/subscriptionStore';
import { normalizePhone } from '@/src/utils/phone';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UserContext = 'CLIENT' | 'WORKER';

type SubscribeRequest = {
  context: UserContext;
  token?: string;
  phone?: string | null;
  registerNo?: string | null;
  userAgent?: string | null;
  platform?: string | null;
  browser?: string | null;
  deviceId?: string | null;
  deviceFingerprint?: string | null;
  locale?: string | null;
};

function cleanString(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function maskFingerprint(raw: string) {
  if (!raw) return raw;
  return raw.length > 8 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : raw;
}

function normalizeRegister(registerRaw: string | null | undefined) {
  const trimmed = cleanString(registerRaw);
  return trimmed ? trimmed.toUpperCase() : '';
}

async function logSubscribeFailure({
  status,
  message,
  context,
}: {
  status: number;
  message: string;
  context: Record<string, unknown>;
}) {
  await logEtcError({
    level: status >= 500 ? 1 : 3,
    message: `푸시 구독 실패(${status})`,
    context,
    appName: 'web',
  });
}

export async function POST(request: Request) {
  let body: SubscribeRequest | null = null;

  try {
    body = (await request.json().catch(() => null)) as SubscribeRequest | null;
    if (!body) {
      return NextResponse.json({ message: '유효한 요청이 아닙니다.' }, { status: 400 });
    }

    const context = body.context;
    if (context !== 'CLIENT' && context !== 'WORKER') {
      return NextResponse.json({ message: 'context가 필요합니다.' }, { status: 400 });
    }

    const rawToken = cleanString(body.token);
    if (!rawToken) {
      const status = 400;
      const message = 'registration token이 필요합니다.';
      await logSubscribeFailure({ status, message, context: { reason: 'missing_token' } });
      return NextResponse.json({ message }, { status });
    }

    if (isInvalidTokenFormat(rawToken)) {
      const status = 400;
      const message = 'INVALID_TOKEN';
      await logSubscribeFailure({ status, message, context: { reason: 'invalid_token_format' } });
      return NextResponse.json({ message }, { status });
    }

    const registrationToken = normalizeToken(rawToken);
    const deviceFingerprint = cleanString(body.deviceFingerprint);
    if (!deviceFingerprint) {
      const status = 400;
      const message = 'device_fingerprint가 필요합니다.';
      await logSubscribeFailure({
        status,
        message,
        context: { reason: 'missing_device_fingerprint', tokenPrefix: registrationToken.slice(0, 8) },
      });
      return NextResponse.json({ message }, { status });
    }
    const normalizedPhone = normalizePhone(body.phone);
    const normalizedRegister = normalizeRegister(body.registerNo);

    if (context === 'CLIENT') {
      if (!normalizedPhone || !normalizedRegister) {
        const status = 400;
        const message = 'CLIENT 구독에는 phone과 registerNo가 모두 필요합니다.';
        await logSubscribeFailure({
          status,
          message,
          context: { reason: 'client_missing_identifiers', hasPhone: Boolean(normalizedPhone), hasRegister: Boolean(normalizedRegister) },
        });
        return NextResponse.json({ message }, { status });
      }

      const [client] = await db
        .select({ id: clientHeader.id })
        .from(clientHeader)
        .where(and(eq(clientHeader.phone, normalizedPhone), eq(clientHeader.registerCode, normalizedRegister)))
        .limit(1);

      if (!client) {
        const status = 404;
        const message = '일치하는 CLIENT를 찾을 수 없습니다.';
        await logSubscribeFailure({
          status,
          message,
          context: { reason: 'client_not_found', phone: normalizedPhone, register: normalizedRegister },
        });
        return NextResponse.json({ message }, { status });
      }

      await upsertSubscription({
        userType: 'CLIENT',
        userId: client.id,
        token: registrationToken,
        deviceFingerprint,
        userAgent: body.userAgent ?? undefined,
        platform: body.platform ?? undefined,
        browser: body.browser ?? undefined,
        deviceId: body.deviceId ?? undefined,
        locale: body.locale ?? undefined,
      });

      return NextResponse.json({ message: 'CLIENT 구독이 저장되었습니다.', userId: client.id });
    }

    if (!normalizedPhone && !normalizedRegister) {
      const status = 400;
      const message = 'WORKER 구독에는 phone 또는 registerNo 중 하나가 필요합니다.';
      await logSubscribeFailure({
        status,
        message,
        context: { reason: 'worker_missing_identifiers', hasPhone: Boolean(normalizedPhone), hasRegister: Boolean(normalizedRegister) },
      });
      return NextResponse.json({ message }, { status });
    }

    const [worker] = await db
      .select({ id: workerHeader.id })
      .from(workerHeader)
      .where(normalizedPhone ? eq(workerHeader.phone, normalizedPhone) : eq(workerHeader.registerCode, normalizedRegister))
      .limit(1);

    if (!worker) {
      const status = 404;
      const message = '일치하는 WORKER를 찾을 수 없습니다.';
      await logSubscribeFailure({
        status,
        message,
        context: { reason: 'worker_not_found', phone: normalizedPhone ?? null, register: normalizedRegister },
      });
      return NextResponse.json({ message }, { status });
    }

    await upsertSubscription({
      userType: 'WORKER',
      userId: worker.id,
      token: registrationToken,
      deviceFingerprint,
      userAgent: body.userAgent ?? undefined,
      platform: body.platform ?? undefined,
      browser: body.browser ?? undefined,
      deviceId: body.deviceId ?? undefined,
      locale: body.locale ?? undefined,
    });

    return NextResponse.json({ message: 'WORKER 구독이 저장되었습니다.', userId: worker.id });
  } catch (error) {
    const sanitizedBody = body
      ? {
          ...body,
          token: undefined,
          deviceFingerprint: body.deviceFingerprint ? maskFingerprint(body.deviceFingerprint) : undefined,
        }
      : undefined;

    await logServerError({
      message: '푸시 구독 저장 실패',
      error,
      context: {
        context: 'subscribe',
        body: sanitizedBody,
      },
    });
    return NextResponse.json({ message: '푸시 구독 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
