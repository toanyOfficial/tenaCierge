import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { createWorkReservation, listOpenRoomsByBuilding, listWorkReservations } from '@/src/server/workReservation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  const [reservations, buildings] = await Promise.all([listWorkReservations(), listOpenRoomsByBuilding()]);
  return NextResponse.json({ reservations, buildings });
}

export async function POST(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const payload = {
      workId: Number(body.workId ?? 0),
      roomId: Number(body.roomId ?? 0),
      amenitiesQty: Number(body.amenitiesQty ?? 0),
      blanketQty: Number(body.blanketQty ?? 0),
      checkinTime: String(body.checkinTime ?? ''),
      checkoutTime: String(body.checkoutTime ?? ''),
      requirements: body.requirements ? String(body.requirements) : null,
      cancelYn: Boolean(body.cancelYn ?? false)
    };

    if (!payload.workId || !payload.roomId || !payload.checkinTime || !payload.checkoutTime) {
      return NextResponse.json({ message: '필수 입력값을 확인해 주세요.' }, { status: 400 });
    }

    const reservations = await createWorkReservation(payload);
    return NextResponse.json({ reservations });
  } catch (error) {
    await logServerError({ appName: 'work-reservations-post', message: '요청사항 생성 실패', error });
    return NextResponse.json({ message: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
