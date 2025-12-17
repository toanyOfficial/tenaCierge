import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyOverviewPoint = {
  label: string;
  totalCount: number;
  roomAverage: number;
};

type MonthlyAggregateRow = {
  month: string;
  totalCount: number;
  roomAverage: number;
};

function formatMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}-01`;
}

function getTrailingMonths() {
  const now = new Date();
  now.setUTCDate(1);

  const months: { key: string; label: string }[] = [];
  for (let offset = 12; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({ key: formatMonthKey(cursor), label: `${cursor.getUTCMonth() + 1}`.padStart(2, '0') });
  }

  return months;
}

export async function fetchMonthlyOverview(): Promise<MonthlyOverviewPoint[]> {
  const anchor = new Date();
  anchor.setUTCDate(1);

  const months = getTrailingMonths();
  const startDate = months[0]?.key;
  const endCursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const endDate = formatMonthKey(endCursor);

  const [rows] = await Promise.all([
    db.execute<MonthlyAggregateRow>(sql`
      SELECT
        month,
        SUM(room_count) AS totalCount,
        AVG(room_count) AS roomAverage
      FROM (
        SELECT
          DATE_FORMAT(wh.date, '%Y-%m-01') AS month,
          wh.room_id AS roomId,
          COUNT(*) AS room_count
        FROM work_header wh
        WHERE wh.cleaning_yn = 1
          AND wh.cancel_yn = 0
          AND wh.date >= ${startDate}
          AND wh.date < ${endDate}
        GROUP BY month, roomId
      ) per_room
      GROUP BY month
    `)
  ]);

  const aggregates = new Map<string, { totalCount: number; roomAverage: number }>();
  rows.forEach((row) => {
    aggregates.set(row.month, {
      totalCount: Number(row.totalCount ?? 0),
      roomAverage: Number(row.roomAverage ?? 0)
    });
  });

  return months.map(({ key, label }) => {
    const stats = aggregates.get(key);
    const totalCount = stats?.totalCount ?? 0;
    const roomAverage = stats?.roomAverage ?? 0;
    return { label, totalCount, roomAverage };
  });
}
