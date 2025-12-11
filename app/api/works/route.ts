import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import { workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { logServerError } from '@/src/server/errorLogger';
import { fetchLatestWorkByDateAndRoom, fetchRoomMeta, fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { validateWorkInput, type WorkMutationValues } from '@/src/server/workValidation';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import {
  getKstNow,
  resolveWorkWindow,
  formatDateKey,
  isDateWithinRange,
  type WorkWindowMeta
} from '@/src/utils/workWindow';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) ?? {};
  const roomId = Number(body?.roomId);

  if (!Number.isFinite(roomId)) {
    return NextResponse.json({ message: '객실 정보가 필요합니다.' }, { status: 400 });
  }

  const profile = await getProfileWithDynamicRoles();
  const isAdmin = profile.roles.includes('admin');
  const isHost = profile.roles.includes('host');

  if (!isAdmin && !isHost) {
    return NextResponse.json({ message: '작업을 생성할 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const requestedDate = typeof body.date === 'string' ? body.date : undefined;

    if (requestedDate && !isDateWithinRange(requestedDate, 7)) {
      return NextResponse.json({ message: '날짜는 D0~D+7 범위에서만 선택할 수 있습니다.' }, { status: 400 });
    }

    const meta = resolveWorkWindow(undefined, requestedDate);
    const insertDate = requestedDate ?? (isAdmin ? resolveAdminInsertDate(meta) : meta.targetDate);

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
      date: insertDate,
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
      buildingId: 0,
      sectorCode: '',
      sectorValue: '',
      cleanerId: null,
      cleaningYn: false,
      conditionCheckYn: false,
      imagesSetId: null,
      checklistSetId: null
    };

    const creationInput = {
      checkoutTime: typeof body.checkoutTime === 'string' ? body.checkoutTime : current.defaultCheckout,
      checkinTime: typeof body.checkinTime === 'string' ? body.checkinTime : current.defaultCheckin,
      blanketQty: typeof body.blanketQty === 'number' ? body.blanketQty : current.bedCount,
      amenitiesQty: typeof body.amenitiesQty === 'number' ? body.amenitiesQty : current.bedCount,
      cancelYn: typeof body.cancelYn === 'boolean' ? body.cancelYn : false,
      requirements: isAdmin && typeof body.requirements === 'string' ? body.requirements : undefined,
      cleaningYn: typeof body.cleaningYn === 'boolean' ? body.cleaningYn : undefined,
      conditionCheckYn: typeof body.conditionCheckYn === 'boolean' ? body.conditionCheckYn : undefined
    };

    const validation = validateWorkInput(creationInput, current, { canEditRequirements: isAdmin });

    if (!validation.ok) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const duplicate = await fetchLatestWorkByDateAndRoom(insertDate, roomMeta.roomId);

    if (duplicate) {
      return NextResponse.json(
        { message: '해당 날짜에 이미 등록된 작업이 있습니다.', work: serializeWorkRow(duplicate) },
        { status: 409 }
      );
    }

    const insertPayload = buildInsertPayload(insertDate, roomMeta.roomId, validation.values);

    const result = await db.insert(workHeader).values(insertPayload);
    const insertIdValue = extractInsertId(result);
    const newId = insertIdValue !== undefined ? Number(insertIdValue) : NaN;

    const refreshed = Number.isFinite(newId)
      ? await fetchWorkRowById(newId)
      : await fetchLatestWorkByDateAndRoom(insertDate, roomMeta.roomId);

    if (!refreshed) {
      return NextResponse.json({ message: '작업 생성 결과를 확인하지 못했습니다.' }, { status: 500 });
    }

    return NextResponse.json({ work: serializeWorkRow(refreshed) });
  } catch (error) {
    await logServerError({
      appName: 'work-create',
      errorCode: 'CREATE_FAIL',
      message: `작업 생성 실패 (roomId=${roomId})`,
      error
    });
    return NextResponse.json({ message: '작업 생성 중 서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

function buildInsertPayload(date: string, roomId: number, values: WorkMutationValues) {
  const cleaningYn = values.cleaningYn !== undefined ? values.cleaningYn : !(values.conditionCheckYn ?? false);
  const conditionCheckYn = values.conditionCheckYn !== undefined ? values.conditionCheckYn : !cleaningYn;

  return {
    date: new Date(`${date}T12:00:00+09:00`),
    roomId,
    checkoutTime: values.checkoutTime ?? '00:00',
    checkinTime: values.checkinTime ?? '00:00',
    blanketQty: values.blanketQty ?? 0,
    amenitiesQty: values.amenitiesQty ?? 0,
    cancelYn: values.cancelYn ?? false,
    requirements: typeof values.requirements === 'string' ? values.requirements : null,
    cleaningYn,
    conditionCheckYn,
    supplyYn: false,
    manualUptYn: true
  };
}

function resolveAdminInsertDate(meta: WorkWindowMeta) {
  const now = getKstNow();
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (minutes >= 16 * 60) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateKey(tomorrow);
  }

  return meta.targetDate;
}

function extractInsertId(result: unknown) {
  if (result && typeof result === 'object' && 'insertId' in result) {
    return (result as { insertId?: number | bigint }).insertId;
  }

  if (Array.isArray(result) && result.length > 0) {
    const candidate = result[0];
    if (candidate && typeof candidate === 'object' && 'insertId' in candidate) {
      return (candidate as { insertId?: number | bigint }).insertId;
    }
  }

  return undefined;
}
