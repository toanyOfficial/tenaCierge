import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workerHeader } from '@/src/db/schema';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

function buildWhereClause(phone?: string, registerNo?: string) {
  const conditions = [];

  if (phone) {
    conditions.push(eq(workerHeader.phone, phone));
  }

  if (registerNo) {
    conditions.push(eq(workerHeader.registerCode, registerNo));
  }

  if (conditions.length === 0) {
    return undefined;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return or(...conditions);
}

function resolveRoleFromTier(tier: number) {
  if (tier === 99) return 'admin';
  if (tier === 7) return 'butler';
  if (tier <= 6) return 'cleaner';
  return 'guest';
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const phoneRaw = typeof body?.phone === 'string' ? body.phone : '';
  const registerRaw = typeof body?.registerNo === 'string' ? body.registerNo : '';

  const normalizedPhone = phoneRaw.replace(/[^0-9]/g, '');
  const normalizedRegister = registerRaw.trim().toUpperCase();

  if (!normalizedPhone && !normalizedRegister) {
    return NextResponse.json(
      { message: '휴대전화 또는 관리번호 중 하나는 반드시 입력해야 합니다.' },
      { status: 400 }
    );
  }

  const whereClause = buildWhereClause(normalizedPhone || undefined, normalizedRegister || undefined);

  if (!whereClause) {
    return NextResponse.json({ message: '유효한 로그인 정보가 필요합니다.' }, { status: 400 });
  }

  const [worker] = await db
    .select({
      id: workerHeader.id,
      name: workerHeader.name,
      phone: workerHeader.phone,
      registerCode: workerHeader.registerCode,
      tier: workerHeader.tier
    })
    .from(workerHeader)
    .where(whereClause)
    .limit(1);

  if (!worker) {
    return NextResponse.json({ message: '일치하는 구성원을 찾지 못했습니다.' }, { status: 404 });
  }

  if (worker.tier === 1) {
    return NextResponse.json({ message: '해당 계정은 현재 로그인할 수 없습니다.' }, { status: 403 });
  }

  const role = resolveRoleFromTier(worker.tier);
  const cookieStore = cookies();
  const secure = process.env.NODE_ENV === 'production';

  const sharedOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE
  };

  cookieStore.set('tc_name', worker.name, sharedOptions);
  cookieStore.set('tc_phone', worker.phone ?? '', sharedOptions);
  cookieStore.set('tc_register', worker.registerCode, sharedOptions);
  cookieStore.set('tc_role', role, sharedOptions);

  return NextResponse.json({
    id: worker.id,
    name: worker.name,
    tier: worker.tier,
    role
  });
}
