import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, workerHeader } from '@/src/db/schema';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

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

function buildWorkerWhereClause(phone?: string, registerNo?: string) {
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

function buildClientWhereClause(phone?: string, registerNo?: string) {
  const conditions = [];

  if (phone) {
    conditions.push(eq(clientHeader.phone, phone));
  }

  if (registerNo) {
    conditions.push(eq(clientHeader.registerCode, registerNo));
  }

  if (conditions.length === 0) {
    return undefined;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return or(...conditions);
}

function resolveRoles(worker?: WorkerRecord | null, client?: ClientRecord | null) {
  const roleOrder: Array<'admin' | 'host' | 'butler' | 'cleaner'> = ['admin', 'host', 'butler', 'cleaner'];
  const roleSet = new Set<string>();

  if (client) {
    roleSet.add('host');
  }

  if (worker) {
    roleSet.add('cleaner');

    if (worker.tier === 7) {
      roleSet.add('butler');
    }

    if (worker.tier === 99) {
      roleSet.add('admin');
    }
  }

  return Array.from(roleSet).sort(
    (a, b) => roleOrder.indexOf(a as typeof roleOrder[number]) - roleOrder.indexOf(b as typeof roleOrder[number])
  );
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

  const workerWhereClause = buildWorkerWhereClause(normalizedPhone || undefined, normalizedRegister || undefined);
  const clientWhereClause = buildClientWhereClause(normalizedPhone || undefined, normalizedRegister || undefined);

  if (!workerWhereClause && !clientWhereClause) {
    return NextResponse.json({ message: '유효한 로그인 정보가 필요합니다.' }, { status: 400 });
  }

  const workerPromise = workerWhereClause
    ? db
        .select({
          id: workerHeader.id,
          name: workerHeader.name,
          phone: workerHeader.phone,
          registerNo: workerHeader.registerCode,
          tier: workerHeader.tier
        })
        .from(workerHeader)
        .where(workerWhereClause)
        .limit(1)
    : Promise.resolve([] as WorkerRecord[]);

  const clientPromise = clientWhereClause
    ? db
        .select({
          id: clientHeader.id,
          name: clientHeader.name,
          phone: clientHeader.phone,
          registerNo: clientHeader.registerCode
        })
        .from(clientHeader)
        .where(clientWhereClause)
        .limit(1)
    : Promise.resolve([] as ClientRecord[]);

  const [[worker], [client]] = await Promise.all([workerPromise, clientPromise]);

  if (!worker && !client) {
    return NextResponse.json({ message: '일치하는 구성원을 찾지 못했습니다.' }, { status: 404 });
  }

  const roles = resolveRoles(worker, client);

  if (roles.length === 0) {
    return NextResponse.json({ message: '해당 계정에 부여할 역할이 없습니다.' }, { status: 403 });
  }

  const profile = {
    name: worker?.name ?? client?.name ?? '이름 미지정',
    phone: worker?.phone ?? client?.phone ?? normalizedPhone,
    registerNo: worker?.registerNo ?? client?.registerNo ?? normalizedRegister
  };

  const cookieStore = cookies();
  const secure = process.env.NODE_ENV === 'production';

  const sharedOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE
  };

  cookieStore.set('tc_name', profile.name, sharedOptions);
  cookieStore.set('tc_phone', profile.phone ?? '', sharedOptions);
  cookieStore.set('tc_register', profile.registerNo ?? '', sharedOptions);
  cookieStore.set('tc_roles', JSON.stringify(roles), sharedOptions);

  return NextResponse.json({ profile, roles });
}
