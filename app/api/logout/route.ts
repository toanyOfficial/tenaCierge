import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_NAMES = ['name', 'phone', 'register_no', 'role_arrange', 'role', 'tc_name', 'tc_phone', 'tc_register', 'tc_roles'] as const;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
