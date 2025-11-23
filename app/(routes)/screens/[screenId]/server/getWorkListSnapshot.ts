import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import {
  clientRooms,
  etcBaseCode,
  etcBuildings,
  etcNotice,
  workApply,
  workAssignment,
  workHeader,
  workerHeader
} from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
import { findClientByProfile } from '@/src/server/clients';
import { findWorkerByProfile } from '@/src/server/workers';
import { getKstNow, formatDateKey } from '@/src/utils/workWindow';
import { logServerError } from '@/src/server/errorLogger';

export type WorkListEntry = {
  id: number;
  roomName: string;
  buildingShortName: string;
  roomNo: string;
  checkoutTime: string;
  checkinTime: string;
  blanketQty: number;
  amenitiesQty: number;
  requirements: string;
  supplyYn: boolean;
  cleaningFlag: number;
  cleaningYn: boolean;
  conditionCheckYn: boolean;
  supervisingEndTime: string | null;
  cleanerId: number | null;
  cleanerName: string;
  buildingId: number;
  sectorCode: string;
  sectorValue: string;
};

export type AssignableWorker = {
  id: number;
  name: string;
  phone: string | null;
  registerCode: string;
  tier: number;
};

export type WorkListSnapshot = {
  notice: string;
  targetDate: string;
  windowLabel: string;
  window?: 'd0' | 'd1';
  windowDates: { d0: string; d1: string };
  works: WorkListEntry[];
  assignableWorkers: AssignableWorker[];
  emptyMessage?: string;
};

export async function getWorkListSnapshot(
  profile: ProfileSummary,
  dateParam?: string,
  windowParam?: 'd0' | 'd1'
): Promise<WorkListSnapshot> {
  try {
    const now = getKstNow();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const { targetDate, window, windowDates } = resolveWindow(now, minutes, dateParam, windowParam);

    const notice = await fetchLatestNotice();

    const worker = await findWorkerByProfile(profile);
    const client = await findClientByProfile(profile);

    const buildingSector = alias(etcBaseCode, 'buildingSector');

    const baseQuery = db
      .select({
        id: workHeader.id,
        date: workHeader.date,
        roomId: workHeader.roomId,
        checkoutTime: workHeader.checkoutTime,
        checkinTime: workHeader.checkinTime,
        blanketQty: workHeader.blanketQty,
        amenitiesQty: workHeader.amenitiesQty,
        requirements: workHeader.requirements,
        supplyYn: workHeader.supplyYn,
        cleaningFlag: workHeader.cleaningFlag,
        cleaningYn: workHeader.cleaningYn,
        conditionCheckYn: workHeader.conditionCheckYn,
        supervisingEndTime: workHeader.supervisingEndTime,
        cleanerId: workHeader.cleanerId,
        roomNo: clientRooms.roomNo,
        buildingId: clientRooms.buildingId,
        sectorCode: etcBuildings.sectorCode,
        sectorValue: buildingSector.value,
        buildingShortName: etcBuildings.shortName,
        cleanerName: workerHeader.name
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .leftJoin(
        buildingSector,
        and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
      )
      .leftJoin(workerHeader, eq(workHeader.cleanerId, workerHeader.id))
      .where(eq(workHeader.date, targetDate));

    let rows:
      | Array<ReturnType<typeof baseQuery>[number] & { assignWorkerId?: number | null }>
      | undefined = undefined;

    let emptyMessage: string | undefined;

    if (profile.primaryRole === 'admin' || profile.roles.includes('admin') || profile.roles.includes('butler')) {
      rows = await baseQuery;
    } else if (profile.roles.includes('host')) {
      if (!client) {
        rows = [];
      } else {
        rows = await baseQuery.where(and(eq(workHeader.date, targetDate), eq(clientRooms.clientId, client.id)));
      }
    } else if (profile.roles.includes('cleaner')) {
      if (!worker) {
        rows = [];
        emptyMessage = '근무자 정보를 찾을 수 없습니다.';
      } else {
        const assignedWorkIds = await fetchAssignedWorkIds(worker.id, targetDate);
        if (!assignedWorkIds.length) {
          rows = [];
          emptyMessage = '아직 할당된 업무가 없습니다.';
        } else {
          rows = await baseQuery.where(and(eq(workHeader.date, targetDate), inArray(workHeader.id, assignedWorkIds)));
        }
      }
    }

  const normalized = (rows ?? []).map((row) => normalizeRow(row));
  const assignableWorkers =
    profile.roles.includes('admin') || profile.roles.includes('butler')
      ? await fetchAssignableWorkers(targetDate)
      : [];
  const buildingCounts = normalized.reduce<Record<number, number>>((acc, row) => {
    acc[row.buildingId] = (acc[row.buildingId] ?? 0) + 1;
    return acc;
  }, {});

  const works = normalized.sort((a, b) => sortRows(a, b, buildingCounts));

    return {
      notice,
      targetDate,
      window,
      windowDates,
      windowLabel:
        window === 'd0' ? `D0 (${windowDates.d0})` : window === 'd1' ? `D+1 (${windowDates.d1})` : targetDate,
      works,
      assignableWorkers,
      emptyMessage
    };
  } catch (error) {
    await logServerError({
      appName: 'work-list',
      errorCode: 'SNAPSHOT_FAIL',
      message: 'getWorkListSnapshot 실패',
      error
    });
    throw error;
  }
}

async function fetchLatestNotice() {
  const rows = await db.select().from(etcNotice).orderBy(desc(etcNotice.noticeDate)).limit(1);
  return rows[0]?.notice ?? '공지사항이 없습니다.';
}

async function fetchAssignedWorkIds(workerId: number, targetDate: string) {
  const rows = await db
    .select({ workId: workAssignment.workId })
    .from(workAssignment)
    .where(and(eq(workAssignment.workerId, workerId), eq(workAssignment.assignDate, targetDate)));

  if (rows.length) {
    return rows.map((row) => Number(row.workId));
  }

  const directRows = await db
    .select({ id: workHeader.id })
    .from(workHeader)
    .where(and(eq(workHeader.date, targetDate), eq(workHeader.cleanerId, workerId)));

  return directRows.map((row) => Number(row.id));
}

function normalizeRow(row: any): WorkListEntry {
  return {
    id: Number(row.id),
    roomName: `${row.buildingShortName ?? ''}${row.roomNo ?? ''}`.trim() || '미지정 객실',
    buildingShortName: row.buildingShortName ?? '',
    roomNo: row.roomNo ?? '',
    checkoutTime: toTime(row.checkoutTime),
    checkinTime: toTime(row.checkinTime),
    blanketQty: Number(row.blanketQty ?? 0),
    amenitiesQty: Number(row.amenitiesQty ?? 0),
    requirements: row.requirements ?? '',
    supplyYn: Boolean(row.supplyYn),
    cleaningFlag: Number(row.cleaningFlag ?? 1),
    cleaningYn: Boolean(row.cleaningYn),
    conditionCheckYn: Boolean(row.conditionCheckYn),
    supervisingEndTime: row.supervisingEndTime ? toTime(row.supervisingEndTime) : null,
    cleanerId: row.cleanerId ? Number(row.cleanerId) : null,
    cleanerName: row.cleanerName ?? '',
    buildingId: Number(row.buildingId ?? 0),
    sectorCode: row.sectorCode ?? '',
    sectorValue: row.sectorValue ?? row.sectorCode ?? ''
  };
}

async function fetchAssignableWorkers(targetDate: string): Promise<AssignableWorker[]> {
  const rows = await db
    .select({
      id: workApply.workerId,
      name: workerHeader.name,
      phone: workerHeader.phone,
      registerCode: workerHeader.registerCode,
      tier: workerHeader.tier
    })
    .from(workApply)
    .leftJoin(workerHeader, eq(workApply.workerId, workerHeader.id))
    .where(and(eq(workApply.workDate, targetDate), isNotNull(workApply.workerId)))
    .orderBy(workApply.workerId);

  const deduped = new Map<number, AssignableWorker>();
  rows.forEach((row) => {
    if (!row.id) return;
    deduped.set(Number(row.id), {
      id: Number(row.id),
      name: row.name ?? '이름 미상',
      phone: row.phone ?? null,
      registerCode: row.registerCode ?? '-',
      tier: Number(row.tier ?? 0)
    });
  });

  return Array.from(deduped.values());
}

function sortRows(a: WorkListEntry, b: WorkListEntry, buildingCounts: Record<number, number>) {
  const aSector = a.sectorValue || a.sectorCode;
  const bSector = b.sectorValue || b.sectorCode;
  if (aSector !== bSector) return aSector.localeCompare(bSector);

  const countDiff = (buildingCounts[b.buildingId] ?? 0) - (buildingCounts[a.buildingId] ?? 0);
  if (countDiff !== 0) return countDiff;

  const aRoom = parseInt(a.roomNo ?? '', 10);
  const bRoom = parseInt(b.roomNo ?? '', 10);

  if (!Number.isNaN(aRoom) && !Number.isNaN(bRoom) && aRoom !== bRoom) {
    return bRoom - aRoom;
  }

  return b.roomNo.localeCompare(a.roomNo);
}

function toTime(value: string | Date | null | undefined) {
  if (!value) return '00:00';
  if (value instanceof Date) {
    return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
  }
  const [h = '00', m = '00'] = value.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function normalizeDate(input?: string) {
  if (!input) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return '';
  return input;
}

function resolveWindow(now: Date, minutes: number, dateParam?: string, windowParam?: 'd0' | 'd1') {
  const today = formatDateKey(now);
  const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (dateParam) {
    const normalized = normalizeDate(dateParam);
    return { targetDate: normalized || today, window: normalized === tomorrow ? 'd1' : 'd0', windowDates: { d0: today, d1: tomorrow } };
  }

  const defaultWindow: 'd0' | 'd1' = minutes < 16 * 60 + 30 ? 'd0' : 'd1';
  const chosen: 'd0' | 'd1' = windowParam && ['d0', 'd1'].includes(windowParam) ? windowParam : defaultWindow;
  const targetDate = chosen === 'd0' ? today : tomorrow;

  return { targetDate, window: chosen, windowDates: { d0: today, d1: tomorrow } };
}
