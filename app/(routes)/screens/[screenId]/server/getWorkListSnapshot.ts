import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { DateTime } from 'luxon';
import { unstable_noStore as noStore } from 'next/cache';

import { db } from '@/src/db/client';
import {
  clientHeader,
  clientRooms,
  etcBaseCode,
  etcBuildings,
  etcNotice,
  workChecklistList,
  workApply,
  workAssignment,
  workHeader,
  workReports,
  workerHeader
} from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
import { findClientByProfile } from '@/src/server/clients';
import { findWorkerByProfile } from '@/src/server/workers';
import { fetchAvailableWorkDates } from '@/src/server/workQueries';
import { getKstNow, formatDateKey, formatWorkDateLabel, type WorkWindowTag } from '@/src/utils/workWindow';
import { logError, logInfo } from '@/src/server/logger';
import { logServerError } from '@/src/server/errorLogger';

export type WorkListEntry = {
  id: number;
  roomName: string;
  buildingShortName: string;
  roomNo: string;
  clientName: string;
  buildingAddressNew: string;
  generalTrashInfo: string;
  foodTrashInfo: string;
  recycleTrashInfo: string;
  buildingPassword: string;
  centralPassword: string;
  doorPassword: string;
  checkoutTime: string;
  checkinTime: string;
  blanketQty: number;
  amenitiesQty: number;
  requirements: string;
  supplyYn: boolean;
  cleaningFlag: number;
  cleaningYn: boolean;
  conditionCheckYn: boolean;
  supervisingYn: boolean;
  supervisingEndTime: string | null;
  cleanerId: number | null;
  cleanerName: string;
  buildingId: number;
  sectorCode: string;
  sectorValue: string;
  hasSupplyReport: boolean;
  supplyRecommendations: SupplyRecommendation[];
  hasPhotoReport: boolean;
  photos: WorkImage[];
  realtimeOverviewYn: boolean;
  imagesYn: boolean;
};

export type SupplyRecommendation = { title: string; description: string; href?: string };

export type WorkImage = { slotId?: number; url: string };

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
  dateOptions: { value: string; label: string }[];
  works: WorkListEntry[];
  assignableWorkers: AssignableWorker[];
  emptyMessage?: string;
  currentMinutes: number;
  hostReadOnly?: boolean;
};

function buildKstDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function buildDateParam(dateKey: string) {
  return dateKey;
}

function normalizeDate(input?: string) {
  if (!input) return '';

  const trimmed = input.trim();
  const candidate = /^\d{8}$/.test(trimmed)
    ? `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
    : trimmed;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';

  const parsed = buildKstDate(candidate);
  if (Number.isNaN(parsed.getTime())) return '';

  return formatDateKey(parsed);
}

async function buildDateOptions(targetDate: string, now: Date) {
  const today = formatDateKey(now);
  const todayDate = buildKstDate(today);
  const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const dates = new Set<string>();

  const resolveTag = (value: string): WorkWindowTag => {
    const diff = Math.round((buildKstDate(value).getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));
    if (diff <= 0) return 'D0';
    const offset = Math.min(diff, 7);
    return (`D+${offset}` as WorkWindowTag);
  };

  const addIfValid = (value: string, allowPast = false) => {
    const parsed = buildKstDate(value);
    if (Number.isNaN(parsed.getTime())) return;
    if (!allowPast && parsed < todayDate) return;
    dates.add(value);
  };

  addIfValid(today, true);
  addIfValid(tomorrow, true);
  (await fetchAvailableWorkDates()).forEach((date) => addIfValid(date));
  addIfValid(targetDate, true);

  return Array.from(dates)
    .map((value) => {
      const tag = resolveTag(value);
      return { value, label: formatWorkDateLabel(tag, value) };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveSupplyNote(contents2: unknown, checklistId: number) {
  if (contents2 && typeof contents2 === 'object') {
    if (!Array.isArray(contents2)) {
      const value = (contents2 as Record<string, unknown>)[String(checklistId)];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return normalizeText(contents2);
}

function sortRows(a: WorkListEntry, b: WorkListEntry, buildingCounts: Record<number, number>) {
  if (a.cleaningYn !== b.cleaningYn) {
    return Number(a.cleaningYn) - Number(b.cleaningYn);
  }

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

function resolveWindow(
  now: Date,
  minutes: number,
  dateParam?: string,
  windowParam?: 'd0' | 'd1'
): { targetDate: string; window?: 'd0' | 'd1'; windowDates: { d0: string; d1: string } } {
  const today = formatDateKey(now);
  const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (dateParam) {
    const normalized = normalizeDate(dateParam);
    return {
      targetDate: normalized || today,
      window: normalized === today ? 'd0' : normalized === tomorrow ? 'd1' : undefined,
      windowDates: { d0: today, d1: tomorrow }
    };
  }

  const defaultWindow: 'd0' | 'd1' = minutes < 16 * 60 + 30 ? 'd0' : 'd1';
  const chosen: 'd0' | 'd1' = windowParam && ['d0', 'd1'].includes(windowParam) ? windowParam : defaultWindow;
  const targetDate = chosen === 'd0' ? today : tomorrow;

  return { targetDate, window: chosen, windowDates: { d0: today, d1: tomorrow } };
}


export async function getWorkListSnapshot(
  profile: ProfileSummary,
  dateParam?: string,
  windowParam?: 'd0' | 'd1'
): Promise<WorkListSnapshot> {
  noStore();
  try {
    const now = getKstNow();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const initialWindow = resolveWindow(now, minutes, dateParam, windowParam);
    const isAdmin = profile.primaryRole === 'admin' || profile.roles.includes('admin');
    const isButler = profile.roles.includes('butler');
    const isCleaner = profile.roles.includes('cleaner');
    const isHost = profile.roles.includes('host');
    const isHostOnly = isHost && !isAdmin && !isButler && !isCleaner;
    const preferToday = isAdmin && !dateParam && !windowParam && initialWindow.window === 'd1';

    const normalizedDateParam = normalizeDate(dateParam ?? '');
    const hostTargetDate = normalizedDateParam || initialWindow.windowDates.d0;

    const targetDate = isHostOnly
      ? hostTargetDate
      : preferToday
        ? initialWindow.windowDates.d0
        : initialWindow.targetDate;
    const window = isHostOnly
      ? hostTargetDate === initialWindow.windowDates.d0
        ? 'd0'
        : hostTargetDate === initialWindow.windowDates.d1
          ? 'd1'
          : undefined
      : preferToday
        ? 'd0'
        : initialWindow.window;
    const windowDates = initialWindow.windowDates;
    const targetDateValue = buildDateParam(targetDate);
    const targetDateSql = sql`CAST(${targetDateValue} AS DATE)`;
    const dateOptions = await buildDateOptions(targetDate, now);

    const hostLockTime = DateTime.fromISO(`${targetDate}T16:00`, { zone: 'Asia/Seoul' })
      .minus({ days: 1 })
      .toJSDate();
    const hostReadOnly = isHostOnly && now.getTime() >= hostLockTime.getTime();

    const notice = await fetchLatestNotice();

    const worker = await findWorkerByProfile(profile);
    const client = await findClientByProfile(profile);

    const buildingSector = alias(etcBaseCode, 'buildingSector');

    const baseQueryBuilder = db
      .select({
        id: workHeader.id,
        date: workHeader.date,
        roomId: workHeader.roomId,
        // Some deployments miss `work_header.checkout_time`; fall back to room defaults to avoid hard failures.
        checkoutTime: clientRooms.checkoutTime,
        checkinTime: workHeader.checkinTime,
        blanketQty: workHeader.blanketQty,
        amenitiesQty: workHeader.amenitiesQty,
        requirements: workHeader.requirements,
        supplyYn: workHeader.supplyYn,
        cleaningFlag: workHeader.cleaningFlag,
        cleaningYn: workHeader.cleaningYn,
        // Some deployments omit `condition_check_yn`; default to false when absent.
        conditionCheckYn: sql<boolean>`0`,
        supervisingYn: workHeader.supervisingYn,
        supervisingEndTime: workHeader.supervisingEndTime,
        cleanerId: workHeader.cleanerId,
        roomNo: clientRooms.roomNo,
        clientName: clientHeader.name,
        centralPassword: clientRooms.centralPassword,
        doorPassword: clientRooms.doorPassword,
        buildingId: clientRooms.buildingId,
        sectorCode: etcBuildings.sectorCode,
        sectorValue: buildingSector.value,
        buildingShortName: etcBuildings.shortName,
        buildingAddressNew: etcBuildings.addressNew,
        buildingPassword: etcBuildings.buildingPassword,
        generalTrashInfo: etcBuildings.buildingGeneral,
        foodTrashInfo: etcBuildings.buildingFood,
        recycleTrashInfo: etcBuildings.buildingRecycle,
        cleanerName: workerHeader.name,
        realtimeOverviewYn: clientRooms.realtimeOverviewYn,
        imagesYn: clientRooms.imagesYn
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
      .leftJoin(clientHeader, eq(clientRooms.clientId, clientHeader.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .leftJoin(
        buildingSector,
        and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
      )
      .leftJoin(workerHeader, eq(workHeader.cleanerId, workerHeader.id));

    const baseQuery = baseQueryBuilder.where(eq(workHeader.date, targetDateSql));

    let rows: Awaited<typeof baseQuery> | undefined = undefined;

    let emptyMessage: string | undefined;

    if (isAdmin || isButler) {
      rows = await baseQuery;
    } else if (isHost) {
      if (!client) {
        rows = [];
      } else {
        rows = await baseQueryBuilder
          .where(and(eq(workHeader.date, targetDateSql), eq(clientRooms.clientId, client.id)))
          .limit(1000);
      }
    } else if (isCleaner) {
      if (!worker) {
        rows = [];
        emptyMessage = '근무자 정보를 찾을 수 없습니다.';
      } else {
        const assignedWorkIds = await fetchAssignedWorkIds(worker.id, targetDate);

        if (!assignedWorkIds.length) {
          const hasApplication = await hasWorkApplication(worker.id, targetDate);
          rows = [];
          emptyMessage = hasApplication ? '아직 할당된 업무가 없습니다.' : '오늘,내일자 업무 신청 내역이 없습니다.';
        } else {
        rows = await baseQueryBuilder
          .where(and(eq(workHeader.date, targetDateSql), inArray(workHeader.id, assignedWorkIds)))
          .limit(1000);
        }
      }
    }

    const normalized = (rows ?? []).map((row) => normalizeRow(row));
  const supplyMap = await fetchLatestSupplyReports(normalized.map((row) => row.id));
  const photoMap = await fetchLatestPhotoReports(normalized.map((row) => row.id));
  const assignableWorkers = isAdmin || isButler ? await fetchAssignableWorkers(targetDate) : [];
  const buildingCounts = normalized.reduce<Record<number, number>>((acc, row) => {
    acc[row.buildingId] = (acc[row.buildingId] ?? 0) + 1;
    return acc;
  }, {});

    const works = normalized
      .map((work) => ({
        ...work,
        hasSupplyReport: supplyMap.has(work.id),
        supplyRecommendations: supplyMap.get(work.id)?.recommendations ?? [],
        hasPhotoReport: photoMap.has(work.id),
        photos: photoMap.get(work.id)?.images ?? []
      }))
      .sort((a, b) => sortRows(a, b, buildingCounts));

    const response = {
      notice,
      targetDate,
      window,
      windowDates,
      windowLabel:
        window === 'd0' && targetDate === windowDates.d0
          ? `D0 (${windowDates.d0})`
          : window === 'd1' && targetDate === windowDates.d1
            ? `D+1 (${windowDates.d1})`
            : targetDate,
      dateOptions,
      works,
      assignableWorkers,
      emptyMessage,
      currentMinutes: minutes,
      hostReadOnly
    };
    await logInfo({
      message: 'work list snapshot fetched',
      context: {
        targetDate,
        targetDateValue,
        window,
        role: profile.primaryRole,
        roles: profile.roles,
        workCount: response.works.length
      }
    });

    return response;
  } catch (error) {
    await logError({
      message: 'getWorkListSnapshot 실패',
      error,
      context: {
        dateParam,
        windowParam
      }
    });
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

async function hasButlerApplication(workerId: number, targetDate: string) {
  const targetDateValue = buildDateParam(targetDate);
  const targetDateSql = sql`CAST(${targetDateValue} AS DATE)`;
  const rows = await db
    .select({ id: workApply.id })
    .from(workApply)
    .where(and(eq(workApply.workerId, workerId), eq(workApply.workDate, targetDateSql), eq(workApply.position, 2)))
    .limit(1);

  return rows.length > 0;
}

async function hasWorkApplication(workerId: number, targetDate: string) {
  const targetDateValue = buildDateParam(targetDate);
  const targetDateSql = sql`CAST(${targetDateValue} AS DATE)`;
  const rows = await db
    .select({ id: workApply.id })
    .from(workApply)
    .where(and(eq(workApply.workerId, workerId), eq(workApply.workDate, targetDateSql)))
    .limit(1);

  return rows.length > 0;
}

async function fetchAssignedWorkIds(workerId: number, targetDate: string) {
  const targetDateValue = buildDateParam(targetDate);
  const targetDateSql = sql`CAST(${targetDateValue} AS DATE)`;
  const rows = await db
    .select({ workId: workAssignment.workId })
    .from(workAssignment)
    .where(and(eq(workAssignment.workerId, workerId), eq(workAssignment.assignDate, targetDateSql)));

  if (rows.length) {
    return rows.map((row) => Number(row.workId));
  }

  const directRows = await db
    .select({ id: workHeader.id })
    .from(workHeader)
    .where(and(eq(workHeader.date, targetDateSql), eq(workHeader.cleanerId, workerId)));

  return directRows.map((row) => Number(row.id));
}

function normalizeRow(row: any): WorkListEntry {
  return {
    id: Number(row.id),
    roomName: `${row.buildingShortName ?? ''}${row.roomNo ?? ''}`.trim() || '미지정 객실',
    buildingShortName: row.buildingShortName ?? '',
    roomNo: row.roomNo ?? '',
    clientName: row.clientName ?? '',
    buildingAddressNew: row.buildingAddressNew ?? '',
    generalTrashInfo: row.generalTrashInfo ?? '',
    foodTrashInfo: row.foodTrashInfo ?? '',
    recycleTrashInfo: row.recycleTrashInfo ?? '',
    buildingPassword: row.buildingPassword ?? '',
    centralPassword: row.centralPassword ?? '',
    doorPassword: row.doorPassword ?? '',
    checkoutTime: toTime(row.checkoutTime),
    checkinTime: toTime(row.checkinTime),
    blanketQty: Number(row.blanketQty ?? 0),
    amenitiesQty: Number(row.amenitiesQty ?? 0),
    requirements: row.requirements ?? '',
    supplyYn: Boolean(row.supplyYn),
    cleaningFlag: Number(row.cleaningFlag ?? 1),
    cleaningYn: Boolean(row.cleaningYn),
    conditionCheckYn: Boolean(row.conditionCheckYn),
    supervisingYn: Boolean(row.supervisingYn),
    supervisingEndTime: row.supervisingEndTime ? toTime(row.supervisingEndTime) : null,
    cleanerId: row.cleanerId ? Number(row.cleanerId) : null,
    cleanerName: row.cleanerName ?? '',
    buildingId: Number(row.buildingId ?? 0),
    sectorCode: row.sectorCode ?? '',
    sectorValue: row.sectorValue ?? row.sectorCode ?? '',
    hasSupplyReport: false,
    supplyRecommendations: [],
    hasPhotoReport: false,
    photos: [],
    realtimeOverviewYn: Boolean(row.realtimeOverviewYn),
    imagesYn: Boolean(row.imagesYn)
  };
}

async function fetchAssignableWorkers(targetDate: string): Promise<AssignableWorker[]> {
  const targetDateValue = buildDateParam(targetDate);
  const targetDateSql = sql`CAST(${targetDateValue} AS DATE)`;
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
    .where(and(eq(workApply.workDate, targetDateSql), isNotNull(workApply.workerId)))
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

async function fetchLatestSupplyReports(workIds: number[]) {
  const map = new Map<number, { recommendations: SupplyRecommendation[] }>();

  if (!workIds.length) return map;

  const rows = await db
    .select({
      workId: workReports.workId,
      contents1: workReports.contents1,
      contents2: workReports.contents2,
      createdAt: workReports.createdAt
    })
    .from(workReports)
    .where(and(inArray(workReports.workId, workIds), eq(workReports.type, 2)))
    .orderBy(desc(workReports.createdAt));

  const latestByWorkId = new Map<number, { contents1: unknown; contents2: unknown }>();

  rows.forEach((row) => {
    const workId = Number(row.workId);
    if (latestByWorkId.has(workId)) return;
    latestByWorkId.set(workId, { contents1: row.contents1, contents2: row.contents2 });
  });

  const checklistIds = Array.from(
    new Set(
      Array.from(latestByWorkId.values())
        .flatMap((row) => parseChecklistIds(row.contents1))
        .filter((id) => typeof id === 'number')
    )
  ) as number[];

  const checklistLookup = await fetchChecklistLookup(checklistIds);

  latestByWorkId.forEach((row, workId) => {
    map.set(workId, {
      recommendations: parseSupplyRecommendations(row.contents1, row.contents2, checklistLookup)
    });
  });

  return map;
}

async function fetchLatestPhotoReports(workIds: number[]) {
  const map = new Map<number, { images: WorkImage[] }>();

  if (!workIds.length) return map;

  const rows = await db
    .select({ workId: workReports.workId, contents1: workReports.contents1, createdAt: workReports.createdAt })
    .from(workReports)
    .where(and(inArray(workReports.workId, workIds), eq(workReports.type, 3)))
    .orderBy(desc(workReports.createdAt));

  rows.forEach((row) => {
    const workId = Number(row.workId);
    if (map.has(workId)) return;
    map.set(workId, { images: parseWorkImages(row.contents1) });
  });

  return map;
}

async function fetchChecklistLookup(ids: number[]) {
  if (!ids.length) return new Map<number, { title: string; description: string | null }>();

  const rows = await db
    .select({ id: workChecklistList.id, title: workChecklistList.title, description: workChecklistList.description })
    .from(workChecklistList)
    .where(inArray(workChecklistList.id, ids));

  return rows.reduce((acc, row) => {
    acc.set(Number(row.id), { title: row.title, description: row.description ?? null });
    return acc;
  }, new Map<number, { title: string; description: string | null }>());
}

function parseChecklistIds(raw: unknown): number[] {
  if (typeof raw === 'string') {
    try {
      return parseChecklistIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? [Number(raw)] : [];
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return Number(value);
      if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((id): id is number => id !== null);
}

function parseWorkImages(raw: unknown): WorkImage[] {
  const payload = typeof raw === 'string' ? safeParseJson(raw) : raw;
  if (!Array.isArray(payload)) return [];

  const images: WorkImage[] = [];

  payload.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const slotId = Number((item as Record<string, unknown>).slotId);
    const url = (item as Record<string, unknown>).url;
    if (typeof url !== 'string' || !url.trim()) return;
    images.push({ slotId: Number.isFinite(slotId) ? slotId : undefined, url });
  });

  return images;
}

function parseSupplyRecommendations(
  contents1: unknown,
  contents2: unknown,
  checklistLookup: Map<number, { title: string; description: string | null }>
) {
  const ids = parseChecklistIds(contents1);
  if (!ids.length) return [];

  return ids.map((id, idx) => {
    const checklist = checklistLookup.get(id);
    const title = checklist?.title || `항목 ${idx + 1}`;
    const note = resolveSupplyNote(contents2, id);
    const description = checklist?.description ?? note ?? '정보 없음';

    return formatSupplyRecommendation(title, description);
  });
}

function formatSupplyRecommendation(title: string, description: string) {
  const normalized = description?.toString().trim() ?? '';
  const href = /^https?:\/\//i.test(normalized) ? normalized : undefined;

  return {
    title: title || '항목',
    description: href ? '링크 바로가기' : normalized || '정보 없음',
    href
  } satisfies SupplyRecommendation;
}

function normalizeText(value: unknown) {
  if (typeof value === 'string') return value;
  return undefined;
}

