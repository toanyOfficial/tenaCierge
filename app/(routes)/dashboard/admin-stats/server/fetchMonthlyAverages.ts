import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyAveragePoint = {
  label: string;
  totalCount: number;
  averagePerRoom: number;
};

type MonthlyTotalRow = {
  month: string;
  totalCount: number;
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

  const [[openRoomRow]] = await db.execute<{ openRooms: number }>(sql`
    SELECT COUNT(*) AS openRooms
    FROM client_rooms
    WHERE open_yn = 1
  `);

  const openRooms = Number(openRoomRow?.openRooms ?? 0);

  const [rows] = await db.execute<MonthlyTotalRow>(sql`
    SELECT DATE_FORMAT(wh.date, '%Y-%m-01') AS month, COUNT(*) AS totalCount
    FROM work_header wh
    WHERE wh.cleaning_yn = 1
      AND wh.cancel_yn = 0
      AND wh.date >= ${startDate}
      AND wh.date < ${endDate}
    GROUP BY month
  `);

  const groupedTotals = new Map<string, number>();
  rows.forEach((row) => {
    groupedTotals.set(row.month, Number(row.totalCount ?? 0));
  });

  return months.map(({ key, label }) => {
    const totalCount = groupedTotals.get(key) ?? 0;
    const averagePerRoom = openRooms > 0 ? totalCount / openRooms : 0;

    return {
      label,
      totalCount,
      averagePerRoom: Number(averagePerRoom.toFixed(1))
    };
  });
}
