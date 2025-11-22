import { asc, and, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBuildings, workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { fetchWorkRowsByDate, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import type { ProfileSummary } from '@/src/utils/profile';
import { resolveWorkWindow, type WorkWindowMeta } from '@/src/utils/workWindow';

export type RoomOption = {
  roomId: number;
  label: string;
  buildingName: string;
  buildingShortName: string;
  roomNo: string;
  bedCount: number;
  defaultCheckout: string;
  defaultCheckin: string;
  clientId: number;
};

export type CleaningSnapshot = {
  targetTag: WorkWindowMeta['targetTag'];
  targetDateLabel: string;
  targetDate: string;
  window: WorkWindowMeta['window'];
  hostCanEdit: boolean;
  hostCanAdd: boolean;
  works: CleaningWork[];
  hostRoomOptions: RoomOption[];
  adminRoomOptions: RoomOption[];
  hostRoomIds: number[];
  message: string | null;
};

export async function getCleaningSnapshot(profile: ProfileSummary): Promise<CleaningSnapshot> {
  const meta = resolveWorkWindow();
  const client = profile.roles.includes('host') ? await findClientByProfile(profile) : null;
  const [works, hostRooms, adminRooms] = await Promise.all([
    getWorks(meta.targetDate),
    client ? getRoomOptions(client.id) : Promise.resolve([]),
    profile.roles.includes('admin') ? getRoomOptions() : Promise.resolve([])
  ]);

  const sortedWorks = works.sort((a, b) => {
    if (a.buildingShortName !== b.buildingShortName) {
      return a.buildingShortName.localeCompare(b.buildingShortName, 'ko');
    }

    if (a.roomNo !== b.roomNo) {
      return a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
    }

    return a.id - b.id;
  });

  return {
    targetTag: meta.targetTag,
    targetDateLabel: meta.targetDateLabel,
    targetDate: meta.targetDate,
    window: meta.window,
    hostCanEdit: meta.hostCanEdit,
    hostCanAdd: meta.hostCanAdd,
    works: sortedWorks,
    hostRoomOptions: hostRooms,
    adminRoomOptions: adminRooms,
    hostRoomIds: hostRooms.map((room) => room.roomId),
    message: null
  };
}

async function getWorks(targetDate: string): Promise<CleaningWork[]> {
  const rows = await fetchWorkRowsByDate(targetDate);
  return rows.map((row) => serializeWorkRow(row));
}

async function getRoomOptions(clientId?: number): Promise<RoomOption[]> {
  const query = db
    .select({
      roomId: clientRooms.id,
      clientId: clientRooms.clientId,
      roomNo: clientRooms.roomNo,
      bedCount: clientRooms.bedCount,
      defaultCheckout: clientRooms.checkoutTime,
      defaultCheckin: clientRooms.checkinTime,
      buildingShortName: etcBuildings.shortName,
      buildingName: etcBuildings.buildingName
    })
    .from(clientRooms)
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id));

  if (typeof clientId === 'number') {
    query.where(and(eq(clientRooms.clientId, clientId), eq(clientRooms.openYn, true)));
  } else {
    query.where(eq(clientRooms.openYn, true));
  }

  const rows = await query.orderBy(asc(etcBuildings.shortName), asc(clientRooms.roomNo));

  return rows.map((row) => ({
    roomId: row.roomId,
    clientId: row.clientId ?? 0,
    roomNo: row.roomNo ?? '-',
    bedCount: row.bedCount ?? 1,
    defaultCheckout: toTimeString(row.defaultCheckout),
    defaultCheckin: toTimeString(row.defaultCheckin),
    buildingShortName: row.buildingShortName ?? 'N/A',
    buildingName: row.buildingName ?? '미지정',
    label: buildRoomName(row.buildingShortName, row.roomNo)
  }));
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
