import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api', '/_next', '/public', '/favicon.ico', '/uploads'];

const TRUSTED_DEVICE_IPS = (process.env.ADMIN_DASHBOARD_DEVICE_WHITELIST ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const ADMIN_DEVICE_COOKIE_PAYLOAD = {
  name: 'Dashboard Device',
  phone: '00000000000',
  registerNo: 'ADMIN_DEVICE',
  roles: ['admin', 'host', 'butler', 'cleaner'],
  role: 'admin'
};

const LONG_LIVED_EXPIRY_DAYS = 90;

function isSecureRequest(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedProto) {
    const proto = forwardedProto.split(',')[0]?.trim().toLowerCase();

    if (proto === 'https') return true;
    if (proto === 'http') return false;
  }

  try {
    if (request.nextUrl.protocol === 'https:') return true;
    if (request.nextUrl.protocol === 'http:') return false;
  } catch (error) {
    // ignore parsing errors and fall through to default
  }

  return false;
}

function resolveClientIp(request: NextRequest) {
  const headerIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  if (headerIp) return headerIp;
  if (request.ip) return request.ip;

  return null;
}

function getLongLivedExpiry(base: Date = new Date()) {
  return new Date(base.getTime() + LONG_LIVED_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (isPublic) return NextResponse.next();

  const cookies = request.cookies;
  const hasPhone = cookies.get('phone')?.value || cookies.get('tc_phone')?.value;
  const hasRegister = cookies.get('register_no')?.value || cookies.get('tc_register')?.value;
  const hasRoles = cookies.get('role_arrange')?.value || cookies.get('tc_roles')?.value;

  const response = NextResponse.next();
  const clientIp = resolveClientIp(request);
  const isTrustedDevice = Boolean(clientIp && TRUSTED_DEVICE_IPS.includes(clientIp));

  if (!hasPhone && !hasRegister && !hasRoles && isTrustedDevice) {
    const secure = isSecureRequest(request);
    const sharedOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/',
      expires: getLongLivedExpiry()
    };

    response.cookies.set('name', ADMIN_DEVICE_COOKIE_PAYLOAD.name, sharedOptions);
    response.cookies.set('phone', ADMIN_DEVICE_COOKIE_PAYLOAD.phone, sharedOptions);
    response.cookies.set('register_no', ADMIN_DEVICE_COOKIE_PAYLOAD.registerNo, sharedOptions);
    response.cookies.set('role_arrange', JSON.stringify(ADMIN_DEVICE_COOKIE_PAYLOAD.roles), sharedOptions);
    response.cookies.set('role', ADMIN_DEVICE_COOKIE_PAYLOAD.role, sharedOptions);

    return response;
  }

  if (!hasPhone && !hasRegister && !hasRoles) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isTrustedDevice) {
    const secure = isSecureRequest(request);
    const sharedOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/',
      expires: getLongLivedExpiry()
    };

    response.cookies.set('name', cookies.get('name')?.value ?? ADMIN_DEVICE_COOKIE_PAYLOAD.name, sharedOptions);
    response.cookies.set('phone', cookies.get('phone')?.value ?? ADMIN_DEVICE_COOKIE_PAYLOAD.phone, sharedOptions);
    response.cookies.set(
      'register_no',
      cookies.get('register_no')?.value ?? ADMIN_DEVICE_COOKIE_PAYLOAD.registerNo,
      sharedOptions
    );
    response.cookies.set(
      'role_arrange',
      cookies.get('role_arrange')?.value ?? JSON.stringify(ADMIN_DEVICE_COOKIE_PAYLOAD.roles),
      sharedOptions
    );
    response.cookies.set('role', cookies.get('role')?.value ?? ADMIN_DEVICE_COOKIE_PAYLOAD.role, sharedOptions);
  }

  return response;
}

export const config = {
  matcher: ['/((?!.*\\.).*)']
};
