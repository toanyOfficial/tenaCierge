import { asc, and, eq } from 'drizzle-orm';
import { unstable_noStore as noStore } from 'next/cache';

import { db } from '@/src/db/client';
import { clientRooms, etcBuildings, workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { findWorkerByProfile } from '@/src/server/workers';
import { fetchWorkRowsByDate, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import type { ProfileSummary } from '@/src/utils/profile';
import {
  buildDateOptions,
  formatDateKey,
  getKstNow,
  resolveWorkWindow,
  type WorkWindowMeta
} from '@/src/utils/workWindow';

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
  today: string;
  maxDate: string;
  dateOptions: { value: string; label: string; tag: WorkWindowMeta['targetTag'] }[];
  hostCanEdit: boolean;
  hostCanAdd: boolean;
  works: CleaningWork[];
  hostRoomOptions: RoomOption[];
  adminRoomOptions: RoomOption[];
  hostRoomIds: number[];
  message: string | null;
  currentWorkerId: number | null;
};

export async function getCleaningSnapshot(profile: ProfileSummary, targetDate?: string): Promise<CleaningSnapshot> {
  noStore();
  const now = getKstNow();
  const today = formatDateKey(now);
  const maxDate = buildMaxDate(today, 7);
  const meta = resolveWorkWindow(undefined, targetDate || undefined);
  const dateOptions = ensureTargetDateOption(buildDateOptions(7, now), meta.targetDate, meta.targetTag);
  const client = profile.roles.includes('host') ? await findClientByProfile(profile) : null;
  const worker = profile.roles.includes('cleaner') ? await findWorkerByProfile(profile) : null;
  const [works, hostRooms, adminRooms] = await Promise.all([
    getWorks(meta.targetDate),
    client ? getRoomOptions(client.id) : Promise.resolve([]),
    profile.roles.includes('admin') ? getRoomOptions() : Promise.resolve([])
  ]);
  const sortedWorks = sortWorks(works);

  return {
    targetTag: meta.targetTag,
    targetDateLabel: meta.targetDateLabel,
    targetDate: meta.targetDate,
    today,
    maxDate,
    dateOptions,
    window: meta.window,
    hostCanEdit: meta.hostCanEdit,
    hostCanAdd: meta.hostCanAdd,
    works: sortedWorks,
    hostRoomOptions: hostRooms,
    adminRoomOptions: adminRooms,
    hostRoomIds: hostRooms.map((room) => room.roomId),
    message: '16:00이 되면 오더수정이 마감됩니다. 반드시 16:00 이전에 수정사항을 반영해주세요.',
    currentWorkerId: worker?.id ?? null
  };
}

function buildMaxDate(today: string, days: number) {
  const base = new Date(`${today}T00:00:00+09:00`);
  base.setDate(base.getDate() + days);
  return formatDateKey(base);
}

function ensureTargetDateOption(
  options: { value: string; label: string; tag: WorkWindowMeta['targetTag'] }[],
  targetDate: string,
  targetTag: WorkWindowMeta['targetTag']
) {
  const existing = options.find((option) => option.value === targetDate);
  if (existing) return options;

  return [
    { value: targetDate, tag: targetTag, label: formatDateKey(new Date(`${targetDate}T00:00:00+09:00`)) },
    ...options
  ];
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

function sortWorks(list: CleaningWork[]) {
  const buildingCounts = list.reduce<Record<number, number>>((acc, work) => {
    acc[work.buildingId] = (acc[work.buildingId] ?? 0) + 1;
    return acc;
  }, {});

  return [...list].sort((a, b) => {
    const aSector = a.sectorValue || a.sectorCode;
    const bSector = b.sectorValue || b.sectorCode;
    if (aSector !== bSector) {
      return aSector.localeCompare(bSector, 'ko');
    }

    const countDiff = (buildingCounts[b.buildingId] ?? 0) - (buildingCounts[a.buildingId] ?? 0);
    if (countDiff !== 0) return countDiff;

    return b.roomNo.localeCompare(a.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
  });
}

function buildRoomName(shortName?: string | null, roomNo?: string | null) {
  const building = shortName ?? '';
  const room = roomNo ?? '';
  return `${building}${room}`.trim() || '미지정 객실';
}
