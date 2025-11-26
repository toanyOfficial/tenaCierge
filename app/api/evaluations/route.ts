import { NextResponse } from 'next/server';

import { fetchEvaluationPage, resolveEvaluationWorker } from '@/src/server/evaluations';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export async function GET(request: Request) {
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
}
