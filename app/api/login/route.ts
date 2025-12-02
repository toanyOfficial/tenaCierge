import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, workApply, workerHeader } from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { getSeoul1630Expiry, isSecureRequest } from '@/src/utils/cookie';
import { formatDateKey, getKstNow } from '@/src/utils/workWindow';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type WorkerRecord = {
  id: number;
  name: string;
  phone: string | null;
  registerNo: string;
  tier: number;
};

type ClientRecord = {
  id: number;
  name: string;
  phone: string;
  registerNo: string;
};

type SearchIdentifier =
  | { type: 'register'; value: string }
  | { type: 'phone'; value: string };

function buildWorkerClause(identifier: SearchIdentifier) {
  return identifier.type === 'register'
    ? eq(workerHeader.registerCode, identifier.value)
    : eq(workerHeader.phone, identifier.value);
}

export async function POST(request: Request) {
  let normalizedPhone = '';
  let normalizedRegister = '';

  try {
    const body = await request.json().catch(() => null);

    const phoneRaw = typeof body?.phone === 'string' ? body.phone : '';
    const registerRaw = typeof body?.registerNo === 'string' ? body.registerNo : '';

    normalizedPhone = phoneRaw.replace(/[^0-9]/g, '');
    normalizedRegister = registerRaw.trim().toUpperCase();

    if (!normalizedPhone && !normalizedRegister) {
      return NextResponse.json(
        { message: '휴대전화 또는 관리번호 중 하나는 반드시 입력해야 합니다.' },
        { status: 400 }
      );
    }

    const hasPhone = Boolean(normalizedPhone);
    const hasRegister = Boolean(normalizedRegister);
    const dates = (() => {
      const now = getKstNow();
      const today = formatDateKey(now);
      const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      return [today, tomorrow].map((value) => new Date(`${value}T00:00:00+09:00`));
    })();

    async function hasUpcomingButler(workId: number) {
      const butlerRows = await db
        .select({ id: workApply.id })
        .from(workApply)
        .where(and(eq(workApply.workerId, workId), eq(workApply.position, 2), inArray(workApply.workDate, dates)));

      return butlerRows.length > 0;
    }

    let roleArrange: string[] = [];
    let primaryRole: string | null = null;
    let profile: { name: string; phone: string | null; registerNo: string | null } | null = null;

    if (hasPhone !== hasRegister) {
      const identifier: SearchIdentifier = hasPhone
        ? { type: 'phone', value: normalizedPhone }
        : { type: 'register', value: normalizedRegister };

      const [workerResult] = await db
        .select({
          id: workerHeader.id,
          name: workerHeader.name,
          phone: workerHeader.phone,
          registerNo: workerHeader.registerCode,
          tier: workerHeader.tier
        })
        .from(workerHeader)
        .where(buildWorkerClause(identifier))
        .limit(1);

      if (!workerResult) {
        return NextResponse.json({ message: '일치하는 구성원을 찾지 못했습니다.' }, { status: 404 });
      }

      if (workerResult.tier === 99) {
        return NextResponse.json(
          { message: '호스트 계정은 휴대폰번호와 관리코드를 함께 입력해주세요.' },
          { status: 400 }
        );
      }

      if (workerResult.tier === 1) {
        return NextResponse.json({ message: '로그인이 제한된 유저입니다.' }, { status: 403 });
      }

      const butlerEligible = await hasUpcomingButler(workerResult.id);
      roleArrange = butlerEligible ? ['cleaner', 'butler'] : ['cleaner'];
      primaryRole = butlerEligible ? 'butler' : 'cleaner';
      profile = {
        name: workerResult.name,
        phone: workerResult.phone,
        registerNo: workerResult.registerNo
      };
    } else {
      const [workerResult] = await db
        .select({
          id: workerHeader.id,
          name: workerHeader.name,
          phone: workerHeader.phone,
          registerNo: workerHeader.registerCode,
          tier: workerHeader.tier
        })
        .from(workerHeader)
        .where(and(eq(workerHeader.phone, normalizedPhone), eq(workerHeader.registerCode, normalizedRegister)))
        .limit(1);

      if (workerResult) {
        if (workerResult.tier === 1) {
          return NextResponse.json({ message: '로그인이 제한된 유저입니다.' }, { status: 403 });
        }

        const butlerEligible = await hasUpcomingButler(workerResult.id);
        roleArrange = butlerEligible ? ['cleaner', 'butler'] : ['cleaner'];

        if (workerResult.tier === 99) {
          roleArrange = ['admin', 'host', ...roleArrange];
          primaryRole = 'admin';
        } else {
          primaryRole = butlerEligible ? 'butler' : 'cleaner';
        }

        profile = {
          name: workerResult.name,
          phone: workerResult.phone,
          registerNo: workerResult.registerNo
        };
      } else {
        const [clientResult] = await db
          .select({
            id: clientHeader.id,
            name: clientHeader.name,
            phone: clientHeader.phone,
            registerNo: clientHeader.registerCode
          })
          .from(clientHeader)
          .where(and(eq(clientHeader.phone, normalizedPhone), eq(clientHeader.registerCode, normalizedRegister)))
          .limit(1);

        if (!clientResult) {
          return NextResponse.json({ message: '일치하는 구성원을 찾지 못했습니다.' }, { status: 404 });
        }

        roleArrange = ['host'];
        primaryRole = 'host';
        profile = {
          name: clientResult.name,
          phone: clientResult.phone,
          registerNo: clientResult.registerNo
        };
      }
    }

    if (!primaryRole || roleArrange.length === 0 || !profile) {
      return NextResponse.json({ message: '해당 계정에 부여할 역할이 없습니다.' }, { status: 403 });
    }

    const cookieStore = cookies();
    const secure = isSecureRequest(request);

    const sharedOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/',
      expires: getSeoul1630Expiry()
    };

    cookieStore.set('name', profile.name ?? '', sharedOptions);
    cookieStore.set('phone', profile.phone ?? '', sharedOptions);
    cookieStore.set('register_no', profile.registerNo ?? '', sharedOptions);
    cookieStore.set('role_arrange', JSON.stringify(roleArrange), sharedOptions);
    cookieStore.set('role', primaryRole, sharedOptions);

    return NextResponse.json({ profile, roleArrange, role: primaryRole });
  } catch (error) {
    await logServerError({
      appName: 'login',
      message: '로그인 처리 실패',
      error,
      context: { normalizedPhone, normalizedRegister }
    });
    return NextResponse.json({ message: '로그인 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
