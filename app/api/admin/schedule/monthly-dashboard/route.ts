import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import { workHeader, workerHeader, workerScheduleException, workerWeeklyPattern } from '@/src/db/schema';
import { formatKstDateKey, nowKst } from '@/src/lib/time';
import { handleAdminError } from '@/src/server/adminCrud';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ensureStartOfWeekKst(date = nowKst()) {
  const weekday = date.weekday % 7; // Monday=1 ... Sunday=7
  return date.startOf('day').minus({ days: weekday });
}

async function ensureAdmin() {
  const profile = await getProfileWithDynamicRoles();
  return profile.roles.includes('admin');
}

export async function GET() {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const today = nowKst();
  const monthStart = today.startOf('month');
  const prevMonthStart = monthStart.minus({ months: 1 }).startOf('month');
  const calendarStart = ensureStartOfWeekKst(monthStart);
  const end = calendarStart.plus({ days: 41 });
  const monthEnd = monthStart.endOf('month');

  try {
    const weeklyPatterns = await db
      .select({ workerId: workerWeeklyPattern.workerId, worker: workerHeader.name, weekday: workerWeeklyPattern.weekday })
      .from(workerWeeklyPattern)
      .leftJoin(workerHeader, eq(workerWeeklyPattern.workerId, workerHeader.id))
      .where(eq(workerHeader.tier, 99))
      .orderBy(asc(workerWeeklyPattern.weekday), asc(workerHeader.name));

    const exceptions = await db
      .select({
        id: workerScheduleException.id,
        workerId: workerScheduleException.workerId,
        worker: workerHeader.name,
        excptDate: workerScheduleException.excptDate,
        addWorkYn: workerScheduleException.addWorkYn,
        cancelWorkYn: workerScheduleException.cancelWorkYn
      })
      .from(workerScheduleException)
      .leftJoin(workerHeader, eq(workerScheduleException.workerId, workerHeader.id))
      .where(
        and(
          eq(workerHeader.tier, 99),
          gte(workerScheduleException.excptDate, formatKstDateKey(prevMonthStart.toJSDate())),
          lte(workerScheduleException.excptDate, formatKstDateKey(end.toJSDate()))
        )
      )
      .orderBy(asc(workerScheduleException.excptDate), asc(workerHeader.name));

    const workCounts = await db
      .select({ date: workHeader.date, count: sql<number>`count(*)` })
      .from(workHeader)
      .where(
        and(
          gte(workHeader.date, formatKstDateKey(prevMonthStart.toJSDate())),
          lte(workHeader.date, formatKstDateKey(monthEnd.toJSDate())),
          eq(workHeader.cleaningYn, true),
          eq(workHeader.cancelYn, false)
        )
      )
      .groupBy(workHeader.date)
      .orderBy(asc(workHeader.date));

    const normalizedWorkCounts = workCounts.map((row) => ({
      date: formatKstDateKey(new Date(row.date)),
      count: Number(row.count)
    }));

    return NextResponse.json({
      startDate: formatKstDateKey(calendarStart.toJSDate()),
      prevMonthStartDate: formatKstDateKey(prevMonthStart.toJSDate()),
      currentMonthStartDate: formatKstDateKey(monthStart.toJSDate()),
      endDate: formatKstDateKey(end.toJSDate()),
      today: formatKstDateKey(today.toJSDate()),
      weeklyPatterns,
      exceptions,
      workCounts: normalizedWorkCounts
    });
  } catch (error) {
    await logServerError({
      appName: 'admin-monthly-dashboard',
      message: '월간 대시보드 데이터를 불러오지 못했습니다.',
      error
    });
    await handleAdminError(error);
    const message = error instanceof Error ? error.message : '월간 데이터를 불러오지 못했습니다.';
    return NextResponse.json({ message }, { status: 500 });
  }
}
