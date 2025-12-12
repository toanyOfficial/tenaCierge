import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBaseCode, etcBuildings, workHeader, workerHeader } from '@/src/db/schema';
import { formatKstDateKey, nowKst } from '@/src/lib/time';
import { listApplyRows } from '@/src/server/workApply';

type RawWorkRow = {
  id: number;
  workDate: Date;
  buildingId: number | null;
  buildingShortName: string | null;
  sectorCode: string | null;
  sectorValue: string | null;
  sectorName: string | null;
  roomNo: string | null;
  cleanerName: string | null;
  cleaningEndTime: string | null;
  supervisingEndTime: string | null;
};

export type WeeklySummaryItem = {
  day: string;
  date: string;
  sectors: { name: string; count: number }[];
};

export type SectorProgress = {
  sector: string;
  total: number;
  completed: number;
  buildings: { name: string; total: number; completed: number }[];
};

export type RoomStatus = {
  sector: string;
  building: string;
  room: string;
  status: 'assign' | 'charge' | 'clean' | 'inspect';
  owner: string;
};

export type ApplyPreview = {
  title: string;
  subtitle: string;
  status: string;
};

export type WeeklyDashboardSnapshot = {
  summary: WeeklySummaryItem[];
  todayProgress: SectorProgress[];
  tomorrowProgress: SectorProgress[];
  roomStatuses: RoomStatus[];
  tomorrowApply: ApplyPreview[];
  capturedAt: string;
};

function startOfKstDay(offsetDays = 0) {
  const now = nowKst().plus({ days: offsetDays }).startOf('day');
  return now.toJSDate();
}

function resolveStatus(row: RawWorkRow): RoomStatus['status'] {
  if (row.supervisingEndTime) return 'inspect';
  if (row.cleaningEndTime) return 'clean';
  if (row.cleanerName) return 'charge';
  return 'assign';
}

function mapSummary(rawRows: RawWorkRow[], baseDate: Date): WeeklySummaryItem[] {
  const days: WeeklySummaryItem[] = [];
  for (let i = 0; i < 8; i += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + i);
    const key = formatKstDateKey(date);
    const sectors = new Map<string, number>();

    rawRows
      .filter((row) => formatKstDateKey(row.workDate) === key)
      .forEach((row) => {
        if (!row.sectorValue) return;
        const label = row.sectorName || row.sectorValue;
        sectors.set(label, (sectors.get(label) ?? 0) + 1);
      });

    days.push({
      day: `D${i}`,
      date: key,
      sectors: Array.from(sectors.entries()).map(([name, count]) => ({ name, count }))
    });
  }
  return days;
}

function mapDayProgress(rawRows: RawWorkRow[], targetKey: string): SectorProgress[] {
  const rows = rawRows.filter((row) => formatKstDateKey(row.workDate) === targetKey);
  const grouped = new Map<string, SectorProgress>();

  rows.forEach((row) => {
    if (!row.sectorValue) return;
    const sectorLabel = row.sectorName || row.sectorValue;
    const buildingName = row.buildingShortName || '미지정';
    const key = sectorLabel;
    const sector = grouped.get(key) || {
      sector: sectorLabel,
      total: 0,
      completed: 0,
      buildings: [] as SectorProgress['buildings']
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

    grouped.set(key, sector);
  });

  return Array.from(grouped.values());
}

function mapRoomStatuses(rawRows: RawWorkRow[], todayKey: string): RoomStatus[] {
  return rawRows
    .filter((row) => formatKstDateKey(row.workDate) === todayKey)
    .map((row) => {
      const building = row.buildingShortName || '미지정';
      const sector = row.sectorName || row.sectorValue || 'N/A';
      return {
        building,
        sector,
        room: row.roomNo || `#${row.id}`,
        status: resolveStatus(row),
        owner: row.cleanerName || '담당자 미지정'
      };
    });
}

async function mapTomorrowApply(tomorrowKey: string): Promise<ApplyPreview[]> {
  const rows = await listApplyRows(tomorrowKey, tomorrowKey);

  return rows.map((row) => ({
    title: `${row.sectorName || row.sectorValue} · ${row.position === 1 ? '1팀' : '2팀'}`,
    subtitle: `슬롯 ${row.seq}번${row.workerName ? ` · 담당 ${row.workerName}` : ''}`,
    status: row.workerName ? '배정 완료' : '대기'
  }));
}

export async function fetchWeeklyDashboardData(): Promise<WeeklyDashboardSnapshot> {
  const baseDate = startOfKstDay(0);
  const endDate = startOfKstDay(7);

  const rawRows = await db
    .select({
      id: workHeader.id,
      workDate: workHeader.date,
      buildingId: etcBuildings.id,
      buildingShortName: etcBuildings.shortName,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: etcBuildings.sectorValue,
      sectorName: etcBaseCode.value,
      roomNo: clientRooms.roomNo,
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
    .where(and(gte(workHeader.date, baseDate), lte(workHeader.date, endDate), eq(workHeader.cancelYn, false)));

  const todayKey = formatKstDateKey(baseDate);
  const tomorrowKey = formatKstDateKey(startOfKstDay(1));

  const summary = mapSummary(rawRows, baseDate);
  const todayProgress = mapDayProgress(rawRows, todayKey);
  const tomorrowProgress = mapDayProgress(rawRows, tomorrowKey);
  const roomStatuses = mapRoomStatuses(rawRows, todayKey);
  const tomorrowApply = await mapTomorrowApply(tomorrowKey);

  return {
    summary,
    todayProgress,
    tomorrowProgress,
    roomStatuses,
    tomorrowApply,
    capturedAt: new Date().toISOString()
  };
}
