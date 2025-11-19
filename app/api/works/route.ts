import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import { workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { fetchRoomMeta, fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { validateWorkInput, type WorkMutationValues } from '@/src/server/workValidation';
import { getProfileSummary } from '@/src/utils/profile';
import { resolveWorkWindow } from '@/src/utils/workWindow';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) ?? {};
  const roomId = Number(body?.roomId);

  if (!Number.isFinite(roomId)) {
    return NextResponse.json({ message: '객실 정보가 필요합니다.' }, { status: 400 });
  }

  const profile = getProfileSummary();
  const isAdmin = profile.roles.includes('admin');
  const isHost = profile.roles.includes('host');

  if (!isAdmin && !isHost) {
    return NextResponse.json({ message: '작업을 생성할 권한이 없습니다.' }, { status: 403 });
  }

  const meta = resolveWorkWindow();

  if (!isAdmin && !meta.hostCanAdd) {
    return NextResponse.json({ message: '현재 시간에는 작업을 추가할 수 없습니다.' }, { status: 403 });
  }

  const roomMeta = await fetchRoomMeta(roomId);

  if (!roomMeta) {
    return NextResponse.json({ message: '해당 객실을 찾지 못했습니다.' }, { status: 404 });
  }

  if (!isAdmin) {
    const client = await findClientByProfile(profile);

    if (!client || roomMeta.clientId !== client.id) {
      return NextResponse.json({ message: '본인 객실에만 작업을 추가할 수 있습니다.' }, { status: 403 });
    }
  }

  const current: CleaningWork = {
    id: 0,
    date: meta.targetDate,
    roomId: roomMeta.roomId,
    roomName: `${roomMeta.buildingShortName}${roomMeta.roomNo}`,
    buildingName: roomMeta.buildingName,
    buildingShortName: roomMeta.buildingShortName,
    roomNo: roomMeta.roomNo,
    cancelYn: Boolean(body.cancelYn),
    checkoutTime: roomMeta.defaultCheckout,
    checkinTime: roomMeta.defaultCheckin,
    blanketQty: roomMeta.bedCount,
    amenitiesQty: roomMeta.bedCount,
    requirements: '',
    bedCount: roomMeta.bedCount,
    defaultCheckout: roomMeta.defaultCheckout,
    defaultCheckin: roomMeta.defaultCheckin,
    clientId: roomMeta.clientId,
  };

  const creationInput = {
    checkoutTime: typeof body.checkoutTime === 'string' ? body.checkoutTime : current.defaultCheckout,
    checkinTime: typeof body.checkinTime === 'string' ? body.checkinTime : current.defaultCheckin,
    blanketQty: typeof body.blanketQty === 'number' ? body.blanketQty : current.bedCount,
    amenitiesQty: typeof body.amenitiesQty === 'number' ? body.amenitiesQty : current.bedCount,
    cancelYn: typeof body.cancelYn === 'boolean' ? body.cancelYn : false,
    requirements: isAdmin && typeof body.requirements === 'string' ? body.requirements : undefined
  };

  const validation = validateWorkInput(creationInput, current, { canEditRequirements: isAdmin });

  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  const insertPayload = buildInsertPayload(meta.targetDate, roomMeta.roomId, validation.values);

  const result = await db.insert(workHeader).values(insertPayload);
  const newId = Number(result.insertId);

  if (!Number.isFinite(newId)) {
    return NextResponse.json({ message: '작업 생성 결과를 확인하지 못했습니다.' }, { status: 500 });
  }

  const refreshed = await fetchWorkRowById(newId);
  const nextState: CleaningWork | null = refreshed ? serializeWorkRow(refreshed) : null;

  return NextResponse.json({ work: nextState });
}

function buildInsertPayload(date: string, roomId: number, values: WorkMutationValues) {
  return {
    date,
    room: roomId,
    checkoutTime: values.checkoutTime,
    checkinTime: values.checkinTime,
    blanketQty: values.blanketQty,
    amenitiesQty: values.amenitiesQty,
    cancelYn: values.cancelYn ?? false,
    requirements: typeof values.requirements === 'string' ? values.requirements : null,
    cleaningYn: true,
    supplyYn: true
  };
}
