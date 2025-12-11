import { NextResponse } from 'next/server';

import { handleAdminError } from '@/src/server/adminCrud';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { getPool } from '@/src/utils/db';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function ensureAdmin() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get('workerId');
  const date = url.searchParams.get('date');

  if (!workerId || !date) {
    return NextResponse.json({ message: 'workerId와 date가 필요합니다.' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, (DAYOFWEEK(?) - 1) AS weekday
       FROM worker_weekly_pattern wwp
       JOIN worker_header wh ON wwp.worker_id = wh.id
       WHERE wh.tier = 99 AND wwp.worker_id = ? AND wwp.weekday = DAYOFWEEK(?) - 1`,
      [date, workerId, date]
    );

    const isWorkingDay = Number(rows[0]?.cnt ?? 0) > 0;
    const weekday = rows[0]?.weekday ?? null;

    return NextResponse.json({ isWorkingDay, weekday });
  } catch (error) {
    await handleAdminError(error);
    const message = error instanceof Error ? error.message : '예외 정보를 불러오지 못했습니다.';
    return NextResponse.json({ message }, { status: 500 });
  }
}
