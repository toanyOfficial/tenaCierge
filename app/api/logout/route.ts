import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_NAMES = ['tc_name', 'tc_phone', 'tc_register', 'tc_roles'] as const;

export async function POST() {
  const cookieStore = cookies();

  COOKIE_NAMES.forEach((name) => {
    cookieStore.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0
    });
  });

  return NextResponse.json({ ok: true });
}
