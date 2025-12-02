import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { isSecureRequest } from '@/src/utils/cookie';

const COOKIE_NAMES = ['name', 'phone', 'register_no', 'role_arrange', 'role', 'tc_name', 'tc_phone', 'tc_register', 'tc_roles'] as const;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const secure = isSecureRequest(request);

    COOKIE_NAMES.forEach((name) => {
      cookieStore.set(name, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 0
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await logServerError({ appName: 'logout', message: '로그아웃 처리 실패', error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
