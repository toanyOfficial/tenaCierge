import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { db } from '@/src/db/client';
import { clientHeader, clientRooms, etcBuildings, workHeader } from '@/src/db/schema';
import { KST, nowKst } from '@/src/lib/time';

export type MonthBucket = { key: string; label: string; daysInMonth: number };

export type MonthlyComboSeries = {
  key: string;
  building: string;
  plan: string;
  values: { month: string; total: number; averagePerDay: number }[];
};

export type MonthlyCompositeRow = {
  month: string;
  roomAverage: number;
  buildingAverage: number;
  total: number;
};

export type WeekdayBuildingStat = { building: string; average: number };

export type WeekdayStat = {
  weekday: string;
  averageTotal: number;
  buildings: WeekdayBuildingStat[];
};

export type StatsTableSnapshot = {
  referenceDate: string;
  months: MonthBucket[];
  monthRange: { start: string; end: string };
  weekdayRange: { start: string; end: string };
  monthlySeries: MonthlyComboSeries[];
  monthlyComposite: MonthlyCompositeRow[];
  weekdayStats: WeekdayStat[];
};

type RawRow = {
  date: Date;
  roomId: number;
  buildingShortName: string | null;
  settleFlag: number | null;
};

function makeMonthBuckets(reference: DateTime): MonthBucket[] {
  const start = reference.startOf('month').minus({ months: 12 });
  const buckets: MonthBucket[] = [];
  let cursor = start;
  for (let i = 0; i < 13; i += 1) {
    buckets.push({ key: cursor.toFormat('yyyy-LL'), label: cursor.toFormat('LL월'), daysInMonth: cursor.daysInMonth });
    cursor = cursor.plus({ months: 1 });
  }
  return buckets;
}

function resolvePlanLabel(settleFlag: number | null) {
  if (settleFlag === 1) return '건별제';
  if (settleFlag === 2) return '정액제';
  return '미지정';
}

function weekdayIndex(date: DateTime) {
  return date.weekday % 7; // luxon: 1=Mon ... 7=Sun -> 0=Sun
}

function weekdayLabel(idx: number) {
  const labels = ['일', '월', '화', '수', '목', '금', '토'];
  return labels[idx] ?? `${idx}요일`;
}

export async function fetchStatsTableSnapshot(referenceDate?: DateTime): Promise<StatsTableSnapshot> {
  const reference = referenceDate ?? nowKst();
  const months = makeMonthBuckets(reference);
  const monthLookup = new Map(months.map((month) => [month.key, month]));

  const weekdayWindowStart = reference.minus({ days: 365 }).startOf('day');
  const monthWindowStart = months[0]?.key
    ? DateTime.fromFormat(`${months[0].key}-01`, 'yyyy-LL-dd', { zone: KST })
    : reference.minus({ months: 12 }).startOf('month');

  const queryStart = DateTime.min(weekdayWindowStart, monthWindowStart).toJSDate();
  const queryEnd = reference.endOf('day').toJSDate();

  const rows = await db
    .select({
      date: workHeader.date,
      roomId: workHeader.roomId,
      buildingShortName: etcBuildings.shortName,
      settleFlag: clientHeader.settleFlag
    })
    .from(workHeader)
    .innerJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .innerJoin(etcBuildings, eq(etcBuildings.id, clientRooms.buildingId))
    .innerJoin(clientHeader, eq(clientHeader.id, clientRooms.clientId))
    .where(and(gte(workHeader.date, queryStart), lte(workHeader.date, queryEnd)));

  const monthTotals = new Map<string, number>();
  const monthRoomMap = new Map<string, Map<number, number>>();
  const monthBuildingMap = new Map<string, Map<string, number>>();
  const comboCounts = new Map<string, { building: string; plan: string; counts: Map<string, number> }>();

  const weekdayDenominators = Array(7).fill(0);
  const weekdayTotals = Array(7).fill(0);
  const weekdayBuildings = Array.from({ length: 7 }, () => new Map<string, number>());

  let dayCursor = weekdayWindowStart;
  while (dayCursor <= reference.endOf('day')) {
    const idx = weekdayIndex(dayCursor);
    weekdayDenominators[idx] += 1;
    dayCursor = dayCursor.plus({ days: 1 });
  }

  rows.forEach((row: RawRow) => {
    const kstDate = DateTime.fromJSDate(row.date, { zone: 'utc' }).setZone(KST);
    const monthKey = kstDate.toFormat('yyyy-LL');
    if (!monthLookup.has(monthKey)) return;

    const building = row.buildingShortName || '미지정';
    const plan = resolvePlanLabel(row.settleFlag);
    const comboKey = `${building}::${plan}`;

    const comboEntry = comboCounts.get(comboKey) || { building, plan, counts: new Map<string, number>() };
    comboEntry.counts.set(monthKey, (comboEntry.counts.get(monthKey) ?? 0) + 1);
    comboCounts.set(comboKey, comboEntry);

    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + 1);

    const roomMap = monthRoomMap.get(monthKey) || new Map<number, number>();
    roomMap.set(row.roomId, (roomMap.get(row.roomId) ?? 0) + 1);
    monthRoomMap.set(monthKey, roomMap);

    const buildingMap = monthBuildingMap.get(monthKey) || new Map<string, number>();
    buildingMap.set(building, (buildingMap.get(building) ?? 0) + 1);
    monthBuildingMap.set(monthKey, buildingMap);

    if (kstDate >= weekdayWindowStart && kstDate <= reference.endOf('day')) {
      const idx = weekdayIndex(kstDate);
      weekdayTotals[idx] += 1;
      const byBuilding = weekdayBuildings[idx];
      byBuilding.set(building, (byBuilding.get(building) ?? 0) + 1);
    }
  });

  const monthlySeries: MonthlyComboSeries[] = Array.from(comboCounts.entries()).map(([key, entry]) => ({
    key,
    building: entry.building,
    plan: entry.plan,
    values: months.map((month) => {
      const total = entry.counts.get(month.key) ?? 0;
      return {
        month: month.key,
        total,
        averagePerDay: month.daysInMonth > 0 ? total / month.daysInMonth : 0
      };
    })
  }));

  const monthlyComposite: MonthlyCompositeRow[] = months.map((month) => {
    const totals = monthTotals.get(month.key) ?? 0;
    const roomMap = monthRoomMap.get(month.key) ?? new Map();
    const buildingMap = monthBuildingMap.get(month.key) ?? new Map();

    const roomAverage = roomMap.size > 0 ? Array.from(roomMap.values()).reduce((a, b) => a + b, 0) / roomMap.size : 0;
    const buildingAverage =
      buildingMap.size > 0 ? Array.from(buildingMap.values()).reduce((a, b) => a + b, 0) / buildingMap.size : 0;

    return {
      month: month.key,
      roomAverage,
      buildingAverage,
      total: totals
    };
  });

  const weekdayStats: WeekdayStat[] = weekdayTotals.map((total, idx) => {
    const denom = weekdayDenominators[idx] || 1;
    const buildingMap = weekdayBuildings[idx];
    const buildings: WeekdayBuildingStat[] = Array.from(buildingMap.entries())
      .map(([building, count]) => ({ building, average: count / denom }))
      .sort((a, b) => b.average - a.average);

    return {
      weekday: weekdayLabel(idx),
      averageTotal: total / denom,
      buildings
    };
  });

  return {
    referenceDate: reference.toISO(),
    months,
    monthRange: { start: months[0]?.key ?? '', end: months[months.length - 1]?.key ?? '' },
    weekdayRange: { start: weekdayWindowStart.toISODate(), end: reference.toISODate() },
    monthlySeries,
    monthlyComposite,
    weekdayStats
  };
}
