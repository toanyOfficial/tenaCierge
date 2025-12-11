import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

import { getPool } from '@/src/db/client';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

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

  try {
    const pool = getPool();
    const [rows] = await pool.query<
      (RowDataPacket & { value: number; label: string; minus_yn?: number; ratio_yn?: number; amount?: number; title?: string })[]
    >(
      `SELECT
        id AS value,
        title AS label,
        minus_yn,
        ratio_yn,
        amount,
        title
      FROM client_price_list
      WHERE selected_by = 3
      ORDER BY title ASC`,
      []
    );

    const options = rows.map((row) => ({
      value: row.value,
      label: row.label ?? String(row.value),
      meta: {
        title: row.title ?? row.label ?? String(row.value),
        minus_yn: row.minus_yn,
        ratio_yn: row.ratio_yn,
        amount: row.amount
      }
    }));

    return NextResponse.json(options);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: '추가비용 항목 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
