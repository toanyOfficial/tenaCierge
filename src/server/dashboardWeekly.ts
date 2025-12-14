import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBaseCode, etcBuildings, workHeader, workerHeader } from '@/src/db/schema';
import { formatKstDateKey, nowKst } from '@/src/lib/time';
import { listApplyRows } from '@/src/server/workApply';

type RawWorkRow = {
  id: number;
  workDate: Date;
  supplyYn: boolean;
  cleaningFlag: number | null;
  supervisingYn: boolean;
  buildingId: number | null;
  buildingShortName: string | null;
  sectorCode: string | null;
  sectorValue: string | null;
  sectorName: string | null;
  roomNo: string | null;
  checkoutTime: string | null;
  cleanerName: string | null;
  cleanerId: number | null;
  cleaningEndTime: string | null;
  supervisingEndTime: string | null;
};

export type WeeklySummaryItem = {
  day: string;
  date: string;
  sectors: { code: string; name: string; count: number }[];
  applyStatus: 'complete' | 'empty' | 'mixed';
};

export type RoleSlotSummary = { role: number; total: number; assigned: number };
export type RoleSlotDetail = { role: number; seq: number; workerName: string | null };
export type RoleSlotGroup = { role: number; slots: RoleSlotDetail[] };

export type CheckoutTimeSummary = { time: string; total: number };
export type CheckoutByBuilding = { building: string; times: CheckoutTimeSummary[] };

export type SectorProgress = {
  code: string;
  sector: string;
  total: number;
  completed: number;
  buildings: { name: string; total: number; completed: number }[];
  applySlots?: RoleSlotSummary[];
  applySlotGroups?: RoleSlotGroup[];
  checkoutTimes?: CheckoutTimeSummary[];
  checkoutByBuilding?: CheckoutByBuilding[];
};

export type RoomStatus = {
  sectorCode: string;
  sector: string;
  buildingCode: number | null;
  building: string;
  room: string;
  supplyYn: boolean;
  cleanerId: number | null;
  cleaningFlag: number | null;
  supervisingYn: boolean;
  owner: string;
};

export type WeeklyDashboardSnapshot = {
  summary: WeeklySummaryItem[];
  todayProgress: SectorProgress[];
  tomorrowProgress: SectorProgress[];
  roomStatuses: RoomStatus[];
  capturedAt: string;
};

function startOfKstDay(offsetDays = 0) {
  const now = nowKst().plus({ days: offsetDays }).startOf('day');
  return now.toJSDate();
}

type SectorCatalog = { code: string; name: string }[];

function resolveApplyStatus(applyRows: Awaited<ReturnType<typeof listApplyRows>>, targetKey: string) {
  const targetRows = applyRows.filter(
    (row) => row.position === 1 && formatKstDateKey(row.workDate) === targetKey
  );

  if (targetRows.length === 0) return 'mixed';

  const hasAssigned = targetRows.some((row) => row.workerId != null);
  const hasUnassigned = targetRows.some((row) => row.workerId == null);

  if (hasAssigned && !hasUnassigned) return 'complete';
  if (hasUnassigned && !hasAssigned) return 'empty';
  return 'mixed';
}

function mapSummary(
  rawRows: RawWorkRow[],
  dayKeys: string[],
  sectorCatalog: SectorCatalog,
  applyRows: Awaited<ReturnType<typeof listApplyRows>>
): WeeklySummaryItem[] {
  const days: WeeklySummaryItem[] = [];
  for (let i = 0; i < dayKeys.length; i += 1) {
    const key = dayKeys[i];

    const daily = sectorCatalog.map((sector) => ({ ...sector, count: 0 }));
    rawRows
      .filter((row) => formatKstDateKey(row.workDate) === key)
      .forEach((row) => {
        if (!row.sectorValue) return;
        const target = daily.find((sector) => sector.code === row.sectorValue);
        if (target) {
          target.count += 1;
        }
      });

    days.push({
      day: i === 0 ? 'D0' : `D+${i}`,
      date: key,
      sectors: daily,
      applyStatus: resolveApplyStatus(applyRows, key)
    });
  }
  return days;
}

function buildRoleSlotMap(
  applyRows: Awaited<ReturnType<typeof listApplyRows>>,
  targetKey: string
): Map<string, { summary: RoleSlotSummary[]; groups: RoleSlotGroup[] }> {
  const slots = applyRows.filter((row) => formatKstDateKey(row.workDate) === targetKey);

  const grouped = new Map<string, { summary: RoleSlotSummary[]; groups: RoleSlotGroup[] }>();

  slots.forEach((slot) => {
    const sectorCode = slot.sectorValue;
    if (!sectorCode) return;

    const entry = grouped.get(sectorCode) || { summary: [] as RoleSlotSummary[], groups: [] as RoleSlotGroup[] };

    const summary = entry.summary;
    const existingSummary = summary.find((s) => s.role === slot.position);
    if (existingSummary) {
      existingSummary.total += 1;
      if (slot.workerId) existingSummary.assigned += 1;
    } else {
      summary.push({ role: slot.position, total: 1, assigned: slot.workerId ? 1 : 0 });
    }

    const groups = entry.groups;
    const group = groups.find((g) => g.role === slot.position);
    if (group) {
      group.slots.push({ role: slot.position, seq: slot.seq, workerName: slot.workerName || null });
    } else {
      groups.push({ role: slot.position, slots: [{ role: slot.position, seq: slot.seq, workerName: slot.workerName || null }] });
    }

    grouped.set(sectorCode, entry);
  });

  return grouped;
}

function mapDayProgress(
  rawRows: RawWorkRow[],
  targetKey: string,
  roleSlotMap?: Map<string, { summary: RoleSlotSummary[]; groups: RoleSlotGroup[] }>
): SectorProgress[] {
  const rows = rawRows.filter((row) => formatKstDateKey(row.workDate) === targetKey);
  const grouped = new Map<string, SectorProgress>();

  rows.forEach((row) => {
    if (!row.sectorValue) return;
    const sectorCode = row.sectorValue;
    const sectorLabel = row.sectorName || sectorCode;
    const buildingName = row.buildingShortName || '미지정';
    const key = sectorCode;
    const sector = grouped.get(key) || {
      code: sectorCode,
      sector: sectorLabel,
      total: 0,
      completed: 0,
      buildings: [] as SectorProgress['buildings'],
      checkoutTimes: [] as SectorProgress['checkoutTimes'],
      checkoutByBuilding: [] as CheckoutByBuilding[]
    };

    const completed = Boolean(row.cleaningEndTime || row.supervisingEndTime);
    sector.total += 1;
    if (completed) {
      sector.completed += 1;
    }

    const buildingEntry = sector.buildings.find((b) => b.name === buildingName);
    if (buildingEntry) {
      buildingEntry.total += 1;
      if (completed) {
        buildingEntry.completed += 1;
      }
    } else {
      sector.buildings.push({ name: buildingName, total: 1, completed: completed ? 1 : 0 });
    }

    const checkoutBuilding = sector.checkoutByBuilding?.find((b) => b.building === buildingName);
    if (!checkoutBuilding) {
      sector.checkoutByBuilding?.push({ building: buildingName, times: [] });
    }

    if (row.checkoutTime) {
      const timeLabel = row.checkoutTime.slice(0, 5);
      const checkoutEntry = sector.checkoutTimes?.find((c) => c.time === timeLabel);
      if (checkoutEntry) {
        checkoutEntry.total += 1;
      } else {
        sector.checkoutTimes?.push({ time: timeLabel, total: 1 });
      }

      const buildingEntry = sector.checkoutByBuilding?.find((b) => b.building === buildingName);
      if (buildingEntry) {
        const timeEntry = buildingEntry.times.find((t) => t.time === timeLabel);
        if (timeEntry) {
          timeEntry.total += 1;
        } else {
          buildingEntry.times.push({ time: timeLabel, total: 1 });
        }
      }
    }

    const roleSlots = roleSlotMap?.get(sectorCode);

    grouped.set(key, {
      ...sector,
      applySlots: roleSlots?.summary?.length ? roleSlots.summary : undefined,
      applySlotGroups: roleSlots?.groups?.length ? roleSlots.groups : undefined,
      checkoutTimes: sector.checkoutTimes?.length ? sector.checkoutTimes : undefined
    });
  });

  return Array.from(grouped.values())
    .map((sector) => ({
      ...sector,
      checkoutTimes: sector.checkoutTimes?.slice().sort((a, b) => a.time.localeCompare(b.time)),
      checkoutByBuilding: sector.checkoutByBuilding?.length
        ? sector.checkoutByBuilding
            .map((entry) => ({
              ...entry,
              times: entry.times.slice().sort((a, b) => a.time.localeCompare(b.time))
            }))
            .sort((a, b) => a.building.localeCompare(b.building))
        : undefined
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function mapRoomStatuses(rawRows: RawWorkRow[], todayKey: string): RoomStatus[] {
  const todaysRows = rawRows.filter((row) => formatKstDateKey(row.workDate) === todayKey);
  const buildingCounts = new Map<string, Map<number, number>>();

  todaysRows.forEach((row) => {
    const sectorCode = row.sectorValue || 'N/A';
    const buildingCode = row.buildingId ?? Number.MAX_SAFE_INTEGER;
    const sectorMap = buildingCounts.get(sectorCode) || new Map<number, number>();
    sectorMap.set(buildingCode, (sectorMap.get(buildingCode) || 0) + 1);
    buildingCounts.set(sectorCode, sectorMap);
  });

  return todaysRows
    .map((row) => {
      const building = row.buildingShortName || '미지정';
      const sector = row.sectorName || row.sectorValue || 'N/A';
      const sectorCode = row.sectorValue || 'N/A';
      const buildingCode = row.buildingId ?? null;
      return {
        sectorCode,
        buildingCode,
        building,
        sector,
        room: row.roomNo || `#${row.id}`,
        supplyYn: Boolean(row.supplyYn),
        cleanerId: row.cleanerId,
        cleaningFlag: row.cleaningFlag,
        supervisingYn: Boolean(row.supervisingYn),
        owner: row.cleanerName || '담당자 미지정'
      };
    })
    .sort((a, b) => {
      const sectorCompare = a.sectorCode.localeCompare(b.sectorCode);
      if (sectorCompare !== 0) return sectorCompare;

      const sectorBuildingCounts = buildingCounts.get(a.sectorCode) || new Map<number, number>();
      const aCode = a.buildingCode ?? Number.MAX_SAFE_INTEGER;
      const bCode = b.buildingCode ?? Number.MAX_SAFE_INTEGER;
      const aCount = sectorBuildingCounts.get(aCode) || 0;
      const bCount = sectorBuildingCounts.get(bCode) || 0;
      if (aCount !== bCount) return bCount - aCount;

      if (aCode !== bCode) return aCode - bCode;

      const buildingCompare = a.building.localeCompare(b.building);
      if (buildingCompare !== 0) return buildingCompare;

      return (b.room || '').localeCompare(a.room || '', undefined, { numeric: true, sensitivity: 'base' });
    });
}

export async function fetchWeeklyDashboardData(): Promise<WeeklyDashboardSnapshot> {
  const tmp_20251215DateOffset = -1; // 임시: 어제 기준으로 스냅샷 요청 (tmp_20251215)
  const baseDate = startOfKstDay(tmp_20251215DateOffset);
  const endDate = startOfKstDay(7);
  const dayKeys = Array.from({ length: 8 }, (_, i) => {
    const next = new Date(baseDate);
    next.setDate(baseDate.getDate() + i);
    return formatKstDateKey(next);
  });

  const sectorCatalog = await db
    .selectDistinct({
      code: etcBuildings.sectorValue,
      name: etcBaseCode.value
    })
    .from(etcBuildings)
    .leftJoin(
      etcBaseCode,
      and(eq(etcBaseCode.codeGroup, etcBuildings.sectorCode), eq(etcBaseCode.code, etcBuildings.sectorValue))
    )
    .where(isNotNull(etcBuildings.sectorValue))
    .orderBy(asc(etcBuildings.sectorValue));

  const startKey = formatKstDateKey(baseDate);
  const endKey = formatKstDateKey(endDate);
  const startDateSql = sql`CAST(${startKey} AS DATE)`;
  const endDateSql = sql`CAST(${endKey} AS DATE)`;

  const applyRows = await listApplyRows(startKey, endKey);

  const rawRows = await db
    .select({
      id: workHeader.id,
      workDate: workHeader.date,
      supplyYn: workHeader.supplyYn,
      cleaningFlag: workHeader.cleaningFlag,
      supervisingYn: workHeader.supervisingYn,
      buildingId: etcBuildings.id,
      buildingShortName: etcBuildings.shortName,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: etcBuildings.sectorValue,
      sectorName: etcBaseCode.value,
      roomNo: clientRooms.roomNo,
      checkoutTime: clientRooms.checkoutTime,
      cleanerId: workHeader.cleanerId,
      cleanerName: workerHeader.name,
      cleaningEndTime: workHeader.cleaningEndTime,
      supervisingEndTime: workHeader.supervisingEndTime
    })
    .from(workHeader)
    .leftJoin(clientRooms, eq(clientRooms.id, workHeader.roomId))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      etcBaseCode,
      and(eq(etcBaseCode.codeGroup, etcBuildings.sectorCode), eq(etcBaseCode.code, etcBuildings.sectorValue))
    )
    .leftJoin(workerHeader, eq(workHeader.cleanerId, workerHeader.id))
    .where(
      and(
        gte(workHeader.date, startDateSql),
        lte(workHeader.date, endDateSql),
        eq(workHeader.cancelYn, false),
        eq(workHeader.cleaningYn, true)
      )
    );

  const todayKey = dayKeys[0];
  const tomorrowKey = dayKeys[1];

  const normalizedCatalog: SectorCatalog = sectorCatalog
    .filter((sector) => Boolean(sector.code))
    .map((sector) => ({ code: sector.code as string, name: sector.name || (sector.code as string) }));

  const todayRoleSlots = buildRoleSlotMap(applyRows, todayKey);
  const tomorrowRoleSlots = buildRoleSlotMap(applyRows, tomorrowKey);

  const summary = mapSummary(rawRows, dayKeys, normalizedCatalog, applyRows);
  const todayProgress = mapDayProgress(rawRows, todayKey, todayRoleSlots);
  const tomorrowProgress = mapDayProgress(rawRows, tomorrowKey, tomorrowRoleSlots);
  const roomStatuses = mapRoomStatuses(rawRows, todayKey);

  return {
    summary,
    todayProgress,
    tomorrowProgress,
    roomStatuses,
    capturedAt: new Date().toISOString()
  };
}
