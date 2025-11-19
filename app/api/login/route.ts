import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, workerHeader } from '@/src/db/schema';

const COOKIE_MAX_AGE = 60 * 60 * 24; // 1일

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

const ROLE_PRIORITY: Array<'admin' | 'host' | 'butler' | 'cleaner'> = ['admin', 'host', 'butler', 'cleaner'];

function buildWorkerClause(identifier: SearchIdentifier) {
  return identifier.type === 'register'
    ? eq(workerHeader.registerCode, identifier.value)
    : eq(workerHeader.phone, identifier.value);
}

function buildClientClause(identifier: SearchIdentifier) {
  return identifier.type === 'register'
    ? eq(clientHeader.registerCode, identifier.value)
    : eq(clientHeader.phone, identifier.value);
}

function appendRole(list: string[], role: 'admin' | 'host' | 'butler' | 'cleaner') {
  if (!list.includes(role)) {
    list.push(role);
  }
}

function resolveRoleArrange(worker: WorkerRecord | null, client: ClientRecord | null) {
  const roles: string[] = [];

  if (client) {
    appendRole(roles, 'host');
  }

  if (worker) {
    appendRole(roles, 'cleaner');

    if (worker.tier === 7) {
      appendRole(roles, 'butler');
    }

    if (worker.tier === 99) {
      appendRole(roles, 'butler');
      appendRole(roles, 'admin');
    }
  }

  return roles;
}

function resolvePrimaryRole(roleArrange: string[]) {
  for (const role of ROLE_PRIORITY) {
    if (roleArrange.includes(role)) {
      return role;
    }
  }

  return null;
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

  const identifiers: SearchIdentifier[] = [];

  if (normalizedRegister) {
    identifiers.push({ type: 'register', value: normalizedRegister });
  }

  if (normalizedPhone) {
    identifiers.push({ type: 'phone', value: normalizedPhone });
  }

  let worker: WorkerRecord | null = null;
  let client: ClientRecord | null = null;

  for (const identifier of identifiers) {
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

    if (workerResult?.tier === 1) {
      return NextResponse.json({ message: '로그인이 제한된 유저입니다.' }, { status: 403 });
    }

    const [clientResult] = await db
      .select({
        id: clientHeader.id,
        name: clientHeader.name,
        phone: clientHeader.phone,
        registerNo: clientHeader.registerCode
      })
      .from(clientHeader)
      .where(buildClientClause(identifier))
      .limit(1);

    if (workerResult || clientResult) {
      worker = workerResult ?? null;
      client = clientResult ?? null;
      break;
    }
  }

  if (!worker && !client) {
    return NextResponse.json({ message: '일치하는 구성원을 찾지 못했습니다.' }, { status: 404 });
  }

  const roleArrange = resolveRoleArrange(worker, client);

  if (roleArrange.length === 0) {
    return NextResponse.json({ message: '해당 계정에 부여할 역할이 없습니다.' }, { status: 403 });
  }

  const primaryRole = resolvePrimaryRole(roleArrange);

  if (!primaryRole) {
    return NextResponse.json({ message: '역할 우선순위를 계산하지 못했습니다.' }, { status: 500 });
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

  cookieStore.set('name', profile.name ?? '', sharedOptions);
  cookieStore.set('phone', profile.phone ?? '', sharedOptions);
  cookieStore.set('register_no', profile.registerNo ?? '', sharedOptions);
  cookieStore.set('role_arrange', JSON.stringify(roleArrange), sharedOptions);
  cookieStore.set('role', primaryRole, sharedOptions);

  return NextResponse.json({ profile, roleArrange, role: primaryRole });
}
