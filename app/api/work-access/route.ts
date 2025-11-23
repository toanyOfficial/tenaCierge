import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workApply, workAssignment, workHeader } from '@/src/db/schema';
import { findWorkerByProfile } from '@/src/server/workers';
import { getProfileSummary } from '@/src/utils/profile';
import { formatDateKey, getKstNow } from '@/src/utils/workWindow';
import { logServerError } from '@/src/server/errorLogger';

export async function GET(request: Request) {
  const profile = getProfileSummary();
  const url = new URL(request.url);
  const role = url.searchParams.get('role') ?? profile.primaryRole ?? '';

  if (!['cleaner', 'butler'].includes(role)) {
    return NextResponse.json({ allowed: true });
  }

  try {
    const worker = await findWorkerByProfile(profile);

    if (!worker) {
      return NextResponse.json({ allowed: false, message: '근무자 정보를 찾을 수 없습니다.' });
    }

    const now = getKstNow();
    const today = formatDateKey(now);
    const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const targetDates = [today, tomorrow];

    const applyRows = await db
      .select({ date: workApply.workDate })
      .from(workApply)
      .where(and(eq(workApply.workerId, worker.id), inArray(workApply.workDate, targetDates)));

    if (!applyRows.length) {
      return NextResponse.json({ allowed: false, message: '오늘,내일 중 업무 신청 사항이 없습니다.' });
    }

    if (role === 'cleaner') {
      const assignmentRows = await db
        .select({ id: workAssignment.id })
        .from(workAssignment)
        .where(and(eq(workAssignment.workerId, worker.id), inArray(workAssignment.assignDate, targetDates)));

      const directRows = await db
        .select({ id: workHeader.id })
        .from(workHeader)
        .where(and(eq(workHeader.cleanerId, worker.id), inArray(workHeader.date, targetDates)));

      const hasAssignment = assignmentRows.length > 0 || directRows.length > 0;

      if (!hasAssignment) {
        return NextResponse.json({ allowed: false, message: '아직 할당된 업무가 없습니다.' });
      }
    }

    return NextResponse.json({ allowed: true });
  } catch (error) {
    await logServerError({
      appName: 'work-access',
      errorCode: 'CHECK_FAIL',
      message: '과업지시서 접근 검증 실패',
      error
    });
    return NextResponse.json({ allowed: false, message: '접근 검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
