import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import {
  fetchWorkGlobalReport,
  markWorkGlobalDetailComplete,
  revertWorkGlobalDetail
} from '@/src/server/workGlobal';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const headerId = Number(searchParams.get('headerId'));
  if (!Number.isFinite(headerId)) {
    return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
  }

  try {
    const report = await fetchWorkGlobalReport(headerId);
    return NextResponse.json({ report });
  } catch (error) {
    await logServerError({ appName: 'work-global-detail', message: '전수작업 상세 조회 실패', error });
    return NextResponse.json({ message: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  const canComplete = profile.roles.some((role) => ['admin', 'butler', 'host', 'cleaner'].includes(role));
  if (!canComplete) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const headerId = Number(body.headerId);
    const roomId = Number(body.roomId);

    if (!Number.isFinite(headerId) || !Number.isFinite(roomId)) {
      return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
    }

    const completedAt = await markWorkGlobalDetailComplete(headerId, roomId);
    return NextResponse.json({ completedAt });
  } catch (error) {
    await logServerError({ appName: 'work-global-detail', message: '전수작업 완료 저장 실패', error });
    return NextResponse.json({ message: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const headerId = Number(body.headerId);
    const roomId = Number(body.roomId);

    if (!Number.isFinite(headerId) || !Number.isFinite(roomId)) {
      return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
    }

    await revertWorkGlobalDetail(headerId, roomId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logServerError({ appName: 'work-global-detail', message: '전수작업 완료 취소 실패', error });
    return NextResponse.json({ message: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
