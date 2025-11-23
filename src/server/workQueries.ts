import { and, asc, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import { clientRooms, etcBaseCode, etcBuildings, workHeader } from '@/src/db/schema';
import type { CleaningWork } from '@/src/server/workTypes';
import { formatDateKey } from '@/src/utils/workWindow';

export type WorkRow = {
  id: number;
  date: string | Date;
  roomId: number;
  buildingId: number | null;
  cancelYn: boolean | null;
  cleaningYn: boolean | null;
  checkoutTime: string | Date | null;
  checkinTime: string | Date | null;
  blanketQty: number | null;
  amenitiesQty: number | null;
  requirements: string | null;
  roomNo: string | null;
  bedCount: number | null;
  defaultCheckout: string | Date | null;
  defaultCheckin: string | Date | null;
  clientId: number | null;
  buildingShortName: string | null;
  buildingName: string | null;
  sectorCode: string | null;
  sectorValue: string | null;
  cleanerId: number | null;
  imagesSetId: number | null;
};

export async function fetchWorkRowsByDate(targetDate: string) {
  const buildingSector = alias(etcBaseCode, 'workSector');

  return db
    .select({
      id: workHeader.id,
      date: workHeader.date,
      roomId: workHeader.roomId,
      buildingId: clientRooms.buildingId,
      cancelYn: workHeader.cancelYn,
      cleaningYn: workHeader.cleaningYn,
      checkoutTime: workHeader.checkoutTime,
      checkinTime: workHeader.checkinTime,
      blanketQty: workHeader.blanketQty,
      amenitiesQty: workHeader.amenitiesQty,
      requirements: workHeader.requirements,
      roomNo: clientRooms.roomNo,
      bedCount: clientRooms.bedCount,
      defaultCheckout: clientRooms.checkoutTime,
      defaultCheckin: clientRooms.checkinTime,
      clientId: clientRooms.clientId,
      buildingShortName: etcBuildings.shortName,
      buildingName: etcBuildings.buildingName,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: buildingSector.value,
      cleanerId: workHeader.cleanerId,
      imagesSetId: clientRooms.imagesSetId
    })
    .from(workHeader)
    .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      buildingSector,
      and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
    )
    .where(eq(workHeader.date, targetDate))
    .orderBy(asc(workHeader.id));
}

export async function fetchWorkRowById(workId: number) {
  const buildingSector = alias(etcBaseCode, 'workSectorById');

  const rows = await db
    .select({
      id: workHeader.id,
      date: workHeader.date,
      roomId: workHeader.roomId,
      buildingId: clientRooms.buildingId,
      cancelYn: workHeader.cancelYn,
      cleaningYn: workHeader.cleaningYn,
      checkoutTime: workHeader.checkoutTime,
      checkinTime: workHeader.checkinTime,
      blanketQty: workHeader.blanketQty,
      amenitiesQty: workHeader.amenitiesQty,
      requirements: workHeader.requirements,
      roomNo: clientRooms.roomNo,
      bedCount: clientRooms.bedCount,
      defaultCheckout: clientRooms.checkoutTime,
      defaultCheckin: clientRooms.checkinTime,
      clientId: clientRooms.clientId,
      buildingShortName: etcBuildings.shortName,
      buildingName: etcBuildings.buildingName,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: buildingSector.value,
      cleanerId: workHeader.cleanerId,
      imagesSetId: clientRooms.imagesSetId
    })
    .from(workHeader)
    .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      buildingSector,
      and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
    )
    .where(eq(workHeader.id, workId))
    .limit(1);

  return rows[0] ?? null;
}

export async function fetchLatestWorkByDateAndRoom(date: string, roomId: number) {
  const buildingSector = alias(etcBaseCode, 'workSectorLatest');

  const rows = await db
    .select({
      id: workHeader.id,
      date: workHeader.date,
      roomId: workHeader.roomId,
      buildingId: clientRooms.buildingId,
      cancelYn: workHeader.cancelYn,
      cleaningYn: workHeader.cleaningYn,
      checkoutTime: workHeader.checkoutTime,
      checkinTime: workHeader.checkinTime,
      blanketQty: workHeader.blanketQty,
      amenitiesQty: workHeader.amenitiesQty,
      requirements: workHeader.requirements,
      roomNo: clientRooms.roomNo,
      bedCount: clientRooms.bedCount,
      defaultCheckout: clientRooms.checkoutTime,
      defaultCheckin: clientRooms.checkinTime,
      clientId: clientRooms.clientId,
      buildingShortName: etcBuildings.shortName,
      buildingName: etcBuildings.buildingName,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: buildingSector.value,
      cleanerId: workHeader.cleanerId,
      imagesSetId: clientRooms.imagesSetId
    })
    .from(workHeader)
    .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      buildingSector,
      and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
    )
    .where(and(eq(workHeader.roomId, roomId), eq(workHeader.date, date)))
    .orderBy(desc(workHeader.id))
    .limit(1);

  return rows[0] ?? null;
}

export function serializeWorkRow(row: WorkRow): CleaningWork {
  return {
    id: row.id,
    date: normalizeDate(row.date),
    roomId: row.roomId,
    buildingId: row.buildingId ?? 0,
    cancelYn: Boolean(row.cancelYn),
    cleaningYn: row.cleaningYn ?? true,
    checkoutTime: toTimeString(row.checkoutTime),
    checkinTime: toTimeString(row.checkinTime),
    blanketQty: row.blanketQty ?? 0,
    amenitiesQty: row.amenitiesQty ?? 0,
    requirements: row.requirements ?? '',
    roomNo: row.roomNo ?? '-',
    bedCount: row.bedCount ?? 1,
    defaultCheckout: toTimeString(row.defaultCheckout),
    defaultCheckin: toTimeString(row.defaultCheckin),
    clientId: row.clientId,
    buildingShortName: row.buildingShortName ?? 'N/A',
    buildingName: row.buildingName ?? '미지정',
    roomName: buildRoomName(row.buildingShortName, row.roomNo),
    sectorCode: row.sectorCode ?? '',
    sectorValue: row.sectorValue ?? row.sectorCode ?? '',
    cleanerId: row.cleanerId ? Number(row.cleanerId) : null,
    imagesSetId: row.imagesSetId ?? null
  };
}

export type RoomMeta = {
  roomId: number;
  clientId: number | null;
  bedCount: number;
  defaultCheckout: string;
  defaultCheckin: string;
  buildingShortName: string;
  buildingName: string;
  roomNo: string;
};

export async function fetchRoomMeta(roomId: number): Promise<RoomMeta | null> {
  const rows = await db
    .select({
      roomId: clientRooms.id,
      clientId: clientRooms.clientId,
      bedCount: clientRooms.bedCount,
      defaultCheckout: clientRooms.checkoutTime,
      defaultCheckin: clientRooms.checkinTime,
      buildingShortName: etcBuildings.shortName,
      buildingName: etcBuildings.buildingName,
      roomNo: clientRooms.roomNo
    })
    .from(clientRooms)
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .where(eq(clientRooms.id, roomId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    roomId: row.roomId,
    clientId: row.clientId ?? null,
    bedCount: row.bedCount ?? 1,
    defaultCheckout: toTimeString(row.defaultCheckout),
    defaultCheckin: toTimeString(row.defaultCheckin),
    buildingShortName: row.buildingShortName ?? 'N/A',
    buildingName: row.buildingName ?? '미지정',
    roomNo: row.roomNo ?? '-'
  };
}

function normalizeDate(value: string | Date) {
  if (value instanceof Date) {
    return formatDateKey(value);
  }

  return value.includes('T') ? value.split('T')[0] : value;
}

function toTimeString(value: string | Date | null | undefined) {
  if (!value) {
    return '00:00';
  }

  if (value instanceof Date) {
    const hours = `${value.getHours()}`.padStart(2, '0');
    const minutes = `${value.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const parts = value.split(':');
  const hour = (parts[0] ?? '00').padStart(2, '0');
  const minute = (parts[1] ?? '00').padStart(2, '0');
  return `${hour}:${minute}`;
}

function buildRoomName(shortName?: string | null, roomNo?: string | null) {
  const building = shortName ?? '';
  const room = roomNo ?? '';
  return `${building}${room}`.trim() || '미지정 객실';
}
