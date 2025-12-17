import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyAveragePoint = {
  label: string;
  roomAverageCount: number;
  totalCount: number;
};

type MonthlyPlanRow = {
  month: string;
  totalCount: number;
};

type RoomCountRow = {
  roomCount: number;
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
    months.push({
      key: formatMonthKey(cursor),
      label: `${cursor.getUTCMonth() + 1}`.padStart(2, '0')
    });
  }

  return months;
}

export async function fetchMonthlyAverages(): Promise<MonthlyAveragePoint[]> {
  const anchor = new Date();
  anchor.setUTCDate(1);

  const months = getTrailingMonths();
  const startDate = months[0]?.key;
  const endCursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const endDate = formatMonthKey(endCursor);

  if (!startDate) {
    return [];
  }

  const [rows] = await db.execute<MonthlyPlanRow>(sql`
    SELECT
      DATE_FORMAT(wh.date, '%Y-%m-01') AS month,
      COUNT(*) AS totalCount
    FROM work_header wh
    WHERE wh.cleaning_yn = 1
      AND wh.cancel_yn = 0
      AND wh.date >= ${startDate}
      AND wh.date < ${endDate}
    GROUP BY month
  `);

  const planRows = Array.isArray(rows) ? rows : [];
  const groupedTotals = new Map<string, { totalCount: number }>();
  planRows.forEach((row) => {
    groupedTotals.set(row.month, { totalCount: Number(row.totalCount ?? 0) });
  });

  const [roomRows] = await db.execute<RoomCountRow>(sql`
    SELECT COUNT(*) AS roomCount
    FROM client_rooms cr
    WHERE cr.open_yn = 1
  `);

  const openRoomCount = Array.isArray(roomRows) ? Number(roomRows[0]?.roomCount ?? 0) : 0;

  return months.map(({ key, label }) => {
    const totals = groupedTotals.get(key) ?? { totalCount: 0 };
    const roomAverageCount = openRoomCount ? totals.totalCount / openRoomCount : 0;

    return {
      label,
      roomAverageCount,
      totalCount: totals.totalCount
    };
  });
}
