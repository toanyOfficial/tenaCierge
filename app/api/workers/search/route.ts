import { NextResponse } from 'next/server';

import { searchWorkersByTerm } from '@/src/server/workers';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const profile = await getProfileWithDynamicRoles();

    if (!profile.roles.includes('admin')) {
      return NextResponse.json({ message: '관리자만 검색할 수 있습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') ?? '';
    const results = await searchWorkersByTerm(query, 20);

    return NextResponse.json({ results });
  } catch (error) {
    await logServerError({ appName: 'workers-search', message: '직원 검색 실패', error });
    return NextResponse.json({ message: '직원 검색 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
