import { NextResponse } from 'next/server';

import { fetchEvaluationPage, resolveEvaluationWorker } from '@/src/server/evaluations';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const profile = await getProfileWithDynamicRoles();
    const { searchParams } = new URL(request.url);
    const workerIdParam = searchParams.get('workerId');
    const cursor = searchParams.get('cursor') ?? undefined;
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? Number(limitParam) : 5;
    const limit = Number.isNaN(parsedLimit) ? 5 : Math.min(Math.max(parsedLimit, 1), 20);
    const requestedWorkerId = workerIdParam ? Number(workerIdParam) : undefined;

    const { worker, reason } = await resolveEvaluationWorker(profile, requestedWorkerId);
    if (!worker) {
      const status = reason?.includes('권한') ? 403 : 400;
      return NextResponse.json({ message: reason ?? '조회할 근로자를 찾을 수 없습니다.' }, { status });
    }

    const page = await fetchEvaluationPage(worker.id, cursor, limit);
    return NextResponse.json(page);
  } catch (error) {
    await logServerError({ appName: 'evaluations', message: '평가 내역 조회 실패', error });
    return NextResponse.json({ message: '평가 내역 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
