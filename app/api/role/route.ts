import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getSeoul1630Expiry, isSecureRequest } from '@/src/utils/cookie';
const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeRoleList(list: string[]) {
  const unique = Array.from(new Set(list.map((role) => role.toLowerCase())));

  return unique
    .filter((role) => roleOrder.includes(role as (typeof roleOrder)[number]))
    .sort((a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number]));
}

function parseRoles(raw: string | undefined | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return normalizeRoleList(parsed.map((entry) => String(entry)));
    }
  } catch (error) {
    // ignore
  }

  return normalizeRoleList(
    raw
      .split(',')
      .map((role) => role.trim())
  );
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : '';

  if (!roleOrder.includes(role as (typeof roleOrder)[number])) {
    return NextResponse.json({ message: '지원되지 않는 역할입니다.' }, { status: 400 });
  }

  const cookieStore = cookies();
  const allowedRoles = parseRoles(cookieStore.get('role_arrange')?.value ?? cookieStore.get('tc_roles')?.value);

  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ message: '쿠키에 포함되지 않은 역할입니다.' }, { status: 403 });
  }

  const secure = isSecureRequest(request);
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    expires: getSeoul1630Expiry()
  };

  cookieStore.set('role', role, options);

  return NextResponse.json({ role });
}
