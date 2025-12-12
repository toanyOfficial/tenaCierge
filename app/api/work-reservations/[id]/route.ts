import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { deleteWorkReservation, updateWorkReservation } from '@/src/server/workReservation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(_req: Request, { params }: { params: { id: string } }) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const body = await _req.json();
    const payload = {
      workId: body.workId === null || body.workId === undefined ? null : Number(body.workId),
      roomId: Number(body.roomId ?? 0),
      amenitiesQty: Number(body.amenitiesQty ?? 0),
      blanketQty: Number(body.blanketQty ?? 0),
      checkinTime: String(body.checkinTime ?? ''),
      checkoutTime: String(body.checkoutTime ?? ''),
      requirements: body.requirements ? String(body.requirements) : null,
      cancelYn: Boolean(body.cancelYn ?? false),
      reflectYn: Boolean(body.reflectYn ?? false)
    };

    if (!payload.roomId || !payload.checkinTime || !payload.checkoutTime) {
      return NextResponse.json({ message: '필수 입력값을 확인해 주세요.' }, { status: 400 });
    }

    const reservations = await updateWorkReservation(Number(params.id), payload, profile.registerNo);
    return NextResponse.json({ reservations });
  } catch (error) {
    await logServerError({ appName: 'work-reservations-put', message: '요청사항 수정 실패', error });
    return NextResponse.json({ message: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const reservations = await deleteWorkReservation(Number(params.id));
    return NextResponse.json({ reservations });
  } catch (error) {
    await logServerError({ appName: 'work-reservations-delete', message: '요청사항 삭제 실패', error });
    return NextResponse.json({ message: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
