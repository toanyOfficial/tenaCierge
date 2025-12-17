import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type WeekdaySeriesMeta = {
  key: string;
  label: string;
};

export type WeekdayStatsPoint = {
  label: string;
  totalCount: number;
  [buildingKey: string]: string | number;
};

type WeekdayCountRow = {
  weekday: number;
  buildingId: number;
  totalCount: number;
};

type WeekdayOccurrenceRow = {
  weekday: number;
  occurrences: number;
};

type BuildingNameRow = {
  buildingId: number;
  shortName: string | null;
};

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];

function makeBuildingKey(buildingId: number) {
  return `building_${buildingId}`;
}

export async function fetchWeekdayStats(): Promise<{
  points: WeekdayStatsPoint[];
  buildings: WeekdaySeriesMeta[];
}> {
  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 365);

  const [[workRows], [occurrenceRows]] = await Promise.all([
    db.execute<WeekdayCountRow>(sql`
      SELECT DAYOFWEEK(wh.date) AS weekday, cr.building_id AS buildingId, COUNT(*) AS totalCount
      FROM work_header wh
      JOIN client_rooms cr ON cr.id = wh.room_id
      WHERE wh.cleaning_yn = 1
        AND wh.cancel_yn = 0
        AND wh.date >= ${startDate}
        AND wh.date < ${endDate}
      GROUP BY cr.building_id, weekday
    `),
    db.execute<WeekdayOccurrenceRow>(sql`
      WITH RECURSIVE dates AS (
        SELECT CAST(${startDate} AS DATE) AS d
        UNION ALL
        SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM dates WHERE d < ${endDate}
      )
      SELECT DAYOFWEEK(d) AS weekday, COUNT(*) AS occurrences
      FROM dates
      WHERE d < ${endDate}
      GROUP BY weekday
    `)
  ]);

  const buildingTotals = new Map<number, Map<number, number>>();
  const totalPerWeekday = new Map<number, number>();

  workRows.forEach((row) => {
    const buildingId = Number(row.buildingId);
    const weekday = Number(row.weekday);
    const totalCount = Number(row.totalCount ?? 0);

    if (!buildingTotals.has(buildingId)) {
      buildingTotals.set(buildingId, new Map<number, number>());
    }
    const inner = buildingTotals.get(buildingId)!;
    inner.set(weekday, totalCount);

    totalPerWeekday.set(weekday, (totalPerWeekday.get(weekday) ?? 0) + totalCount);
  });

  const buildingIds = Array.from(buildingTotals.keys());

  let buildingNames: BuildingNameRow[] = [];
  if (buildingIds.length > 0) {
    [buildingNames] = await db.execute<BuildingNameRow>(sql`
      SELECT id AS buildingId, building_short_name AS shortName
      FROM etc_buildings
      WHERE id IN (${sql.join(buildingIds, sql`,`)})
    `);
  }

  const buildingMeta: WeekdaySeriesMeta[] = buildingIds.map((id) => {
    const match = buildingNames.find((row) => Number(row.buildingId) === id);
    const fallbackLabel = `건물${id}`;
    const trimmed = (match?.shortName || fallbackLabel).slice(0, 2);
    const label = trimmed || fallbackLabel;
    return { key: makeBuildingKey(id), label };
  });

  const occurrenceMap = new Map<number, number>();
  occurrenceRows.forEach((row) => {
    occurrenceMap.set(Number(row.weekday), Number(row.occurrences ?? 0));
  });

  const formatAverage = (value: number) => {
    return Math.round(value * 100) / 100;
  };

  const formatAverage = (value: number) => {
    return Math.round(value * 100) / 100;
  };

  const points: WeekdayStatsPoint[] = weekdayLabels.map((label, index) => {
    const mysqlWeekday = index === 0 ? 1 : index + 1; // DAYOFWEEK: 1=Sunday
    const occurrencesCount = occurrenceMap.get(mysqlWeekday) ?? 0;
    const totalCount = totalPerWeekday.get(mysqlWeekday) ?? 0;
    const totalAverage = occurrencesCount ? totalCount / occurrencesCount : 0;

    const base: WeekdayStatsPoint = { label, totalCount: formatAverage(totalAverage) };

    buildingMeta.forEach(({ key }, metaIndex) => {
      const buildingId = buildingIds[metaIndex];
      const buildingCount = buildingTotals.get(buildingId)?.get(mysqlWeekday) ?? 0;
      const buildingAverage = occurrencesCount ? buildingCount / occurrencesCount : 0;

      base[key] = formatAverage(buildingAverage);
    });

    return base;
  });

  return { points, buildings: buildingMeta };
}
