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

  const url = new URL(request.url);
  const roomId = Number(url.searchParams.get('roomId'));
  const date = url.searchParams.get('date');

  if (!roomId || !date) {
    return NextResponse.json({ message: 'roomId와 date가 필요합니다.' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { nextSeq?: number })[]>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM client_additional_price WHERE room_id = ? AND date = ?',
      [roomId, date]
    );
    const nextSeq = Number(rows?.[0]?.nextSeq ?? 1);
    return NextResponse.json({ nextSeq: Number.isFinite(nextSeq) ? nextSeq : 1 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: '순번 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
