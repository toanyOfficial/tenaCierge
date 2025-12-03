import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api', '/_next', '/public', '/favicon.ico', '/uploads'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (isPublic) return NextResponse.next();

  const cookies = request.cookies;
  const hasPhone = cookies.get('phone')?.value || cookies.get('tc_phone')?.value;
  const hasRegister = cookies.get('register_no')?.value || cookies.get('tc_register')?.value;
  const hasRoles = cookies.get('role_arrange')?.value || cookies.get('tc_roles')?.value;

  if (!hasPhone && !hasRegister && !hasRoles) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\.).*)']
};
