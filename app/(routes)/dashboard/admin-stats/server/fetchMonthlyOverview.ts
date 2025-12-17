import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyOverviewPoint = {
  label: string;
  totalCount: number;
  roomAverage: number;
};

type MonthlyTotalRow = {
  month: string;
  totalCount: number;
};

type OpenRoomRow = {
  openRooms: number;
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

  const [[roomRow], [rows]] = await Promise.all([
    db.execute<OpenRoomRow>(sql`SELECT COUNT(*) AS openRooms FROM client_rooms WHERE open_yn = 1`),
    db.execute<MonthlyTotalRow>(sql`
      SELECT DATE_FORMAT(wh.date, '%Y-%m-01') AS month, COUNT(*) AS totalCount
      FROM work_header wh
      WHERE wh.cleaning_yn = 1
        AND wh.cancel_yn = 0
        AND wh.date >= ${startDate}
        AND wh.date < ${endDate}
      GROUP BY month
    `)
  ]);

  const openRooms = Number(roomRow?.openRooms ?? 0);
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    totals.set(row.month, Number(row.totalCount ?? 0));
  });

  return months.map(({ key, label }) => {
    const totalCount = totals.get(key) ?? 0;
    const roomAverage = openRooms ? totalCount / openRooms : 0;
    return { label, totalCount, roomAverage };
  });
}
