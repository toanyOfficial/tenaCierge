import { NextResponse } from 'next/server';

import { fetchAdminEvaluationView } from '@/src/server/evaluations';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const profile = await getProfileWithDynamicRoles();

    if (!profile.roles.includes('admin')) {
      return NextResponse.json({ message: '관리자만 조회할 수 있습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const targetDate = searchParams.get('targetDate') ?? undefined;

    const adminView = await fetchAdminEvaluationView(targetDate);
    return NextResponse.json(adminView);
  } catch (error) {
    await logServerError({ appName: 'evaluations-admin', message: '관리자 일급/티어 조회 실패', error });
    return NextResponse.json({ message: '데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
