import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    await logServerError({ appName: 'health', message: '헬스 체크 응답 실패', error });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
