import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBuildings, workHeader, workReservation } from '@/src/db/schema';
import { resolveWebActor, withUpdateAuditFields } from '@/src/server/audit';

export type WorkReservationRecord = {
  id: number;
  workId: number | null;
  workDateLabel: string;
  roomId: number;
  buildingId: number | null;
  buildingShortName: string | null;
  roomNo: string | null;
  amenitiesQty: number;
  blanketQty: number;
  checkinTime: string;
  checkoutTime: string;
  requirements: string | null;
  cancelYn: boolean;
  reflectYn: boolean;
};

export type BuildingRoomOption = {
  buildingId: number;
  buildingShortName: string;
  rooms: { roomId: number; roomNo: string; bedCount: number; checkinTime: string; checkoutTime: string }[];
};

type ReservationPayload = {
  workId: number | null;
  roomId: number;
  amenitiesQty: number;
  blanketQty: number;
  checkinTime: string;
  checkoutTime: string;
  requirements?: string | null;
  cancelYn?: boolean;
  reflectYn?: boolean;
};

function parseWorkId(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) {
    throw new Error('잘못된 작업 식별자입니다.');
  }
  return parsed;
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  throw new Error('시간은 HH:mm 형식으로 입력해 주세요.');
}

function formatWorkDateLabel(value: string | Date | null | undefined) {
  if (!value) return '미반영';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '미반영';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mapReservationRow(row: {
  id: number;
  workId: number | string | null;
  workDate: string | Date | null;
  roomId: number;
  buildingId: number | null;
  buildingShortName: string | null;
  roomNo: string | null;
  amenitiesQty: number;
  blanketQty: number;
  checkinTime: string;
  checkoutTime: string;
  requirements: string | null;
  cancelYn: number | boolean;
  reflectYn: number | boolean;
}): WorkReservationRecord {
  const formatTime = (time: string) => (time ? time.substring(0, 5) : '');
  return {
    id: Number(row.id),
    workId: row.workId === null ? null : Number(row.workId),
    workDateLabel: formatWorkDateLabel(row.workDate),
    roomId: Number(row.roomId),
    buildingId: row.buildingId ? Number(row.buildingId) : null,
    buildingShortName: row.buildingShortName,
    roomNo: row.roomNo,
    amenitiesQty: Number(row.amenitiesQty),
    blanketQty: Number(row.blanketQty),
    checkinTime: formatTime(row.checkinTime),
    checkoutTime: formatTime(row.checkoutTime),
    requirements: row.requirements,
    cancelYn: Boolean(row.cancelYn),
    reflectYn: Boolean(row.reflectYn)
  };
}

export async function listWorkReservations(): Promise<WorkReservationRecord[]> {
  const rows = await db
    .select({
      id: workReservation.id,
      workId: workReservation.workId,
      workDate: workHeader.date,
      roomId: workReservation.roomId,
      buildingId: etcBuildings.id,
      buildingShortName: etcBuildings.shortName,
      roomNo: clientRooms.roomNo,
      amenitiesQty: workReservation.amenitiesQty,
      blanketQty: workReservation.blanketQty,
      checkinTime: workReservation.checkinTime,
      checkoutTime: workReservation.checkoutTime,
      requirements: workReservation.requirements,
      cancelYn: workReservation.cancelYn,
      reflectYn: workReservation.reflectYn
    })
    .from(workReservation)
    .leftJoin(clientRooms, eq(clientRooms.id, workReservation.roomId))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(workHeader, eq(workHeader.id, workReservation.workId))
    .orderBy(desc(workReservation.workId), desc(workReservation.id));

  return rows.map(mapReservationRow);
}

export async function getWorkReservation(id: number): Promise<WorkReservationRecord | null> {
  const [row] = await db
    .select({
      id: workReservation.id,
      workId: workReservation.workId,
      workDate: workHeader.date,
      roomId: workReservation.roomId,
      buildingId: etcBuildings.id,
      buildingShortName: etcBuildings.shortName,
      roomNo: clientRooms.roomNo,
      amenitiesQty: workReservation.amenitiesQty,
      blanketQty: workReservation.blanketQty,
      checkinTime: workReservation.checkinTime,
      checkoutTime: workReservation.checkoutTime,
      requirements: workReservation.requirements,
      cancelYn: workReservation.cancelYn,
      reflectYn: workReservation.reflectYn
    })
    .from(workReservation)
    .leftJoin(clientRooms, eq(clientRooms.id, workReservation.roomId))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(workHeader, eq(workHeader.id, workReservation.workId))
    .where(eq(workReservation.id, id))
    .limit(1);

  return row ? mapReservationRow(row) : null;
}

export async function listOpenRoomsByBuilding(): Promise<BuildingRoomOption[]> {
  const rows = await db
    .select({
      buildingId: etcBuildings.id,
      buildingShortName: etcBuildings.shortName,
      roomId: clientRooms.id,
      roomNo: clientRooms.roomNo,
      bedCount: clientRooms.bedCount,
      checkinTime: clientRooms.checkinTime,
      checkoutTime: clientRooms.checkoutTime
    })
    .from(clientRooms)
    .innerJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .where(eq(clientRooms.openYn, true))
    .orderBy(asc(etcBuildings.shortName), asc(clientRooms.roomNo));

  const grouped = new Map<number, BuildingRoomOption>();

  const formatTime = (time: string | null) => (time ? time.substring(0, 5) : '');

  rows.forEach((row) => {
    const existing = grouped.get(Number(row.buildingId));
    if (existing) {
      existing.rooms.push({
        roomId: Number(row.roomId),
        roomNo: row.roomNo ?? '',
        bedCount: Number(row.bedCount ?? 0),
        checkinTime: formatTime(row.checkinTime),
        checkoutTime: formatTime(row.checkoutTime)
      });
      return;
    }
    grouped.set(Number(row.buildingId), {
      buildingId: Number(row.buildingId),
      buildingShortName: row.buildingShortName ?? '',
      rooms: [
        {
          roomId: Number(row.roomId),
          roomNo: row.roomNo ?? '',
          bedCount: Number(row.bedCount ?? 0),
          checkinTime: formatTime(row.checkinTime),
          checkoutTime: formatTime(row.checkoutTime)
        }
      ]
    });
  });

  return Array.from(grouped.values());
}

export async function createWorkReservation(payload: ReservationPayload) {
  const workId = parseWorkId(payload.workId);

  const checkinTime = normalizeTime(payload.checkinTime);
  const checkoutTime = normalizeTime(payload.checkoutTime);

  if (!checkinTime || !checkoutTime) {
    throw new Error('입퇴실 시간을 확인해 주세요.');
  }

  await db.insert(workReservation).values({
    workId,
    roomId: payload.roomId,
    amenitiesQty: payload.amenitiesQty,
    blanketQty: payload.blanketQty,
    checkinTime,
    checkoutTime,
    requirements: payload.requirements ?? null,
    cancelYn: Boolean(payload.cancelYn),
    reflectYn: Boolean(payload.reflectYn)
  });

  return listWorkReservations();
}

export async function updateWorkReservation(id: number, payload: ReservationPayload, actor = resolveWebActor()) {
  const existing = await getWorkReservation(id);
  if (!existing) {
    throw new Error('대상을 찾을 수 없습니다.');
  }

  const workId = parseWorkId(payload.workId);

  const checkinTime = normalizeTime(payload.checkinTime);
  const checkoutTime = normalizeTime(payload.checkoutTime);

  if (!checkinTime || !checkoutTime) {
    throw new Error('입퇴실 시간을 확인해 주세요.');
  }

  await db
    .update(workReservation)
    .set(
      withUpdateAuditFields(
        {
          workId,
          roomId: payload.roomId,
          amenitiesQty: payload.amenitiesQty,
          blanketQty: payload.blanketQty,
          checkinTime,
          checkoutTime,
          requirements: payload.requirements ?? null,
          cancelYn: Boolean(payload.cancelYn),
          reflectYn: Boolean(payload.reflectYn)
        },
        actor
      )
    )
    .where(eq(workReservation.id, id));

  return listWorkReservations();
}

export async function deleteWorkReservation(id: number) {
  await db.delete(workReservation).where(eq(workReservation.id, id));
  return listWorkReservations();
}
