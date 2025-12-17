import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type WeekdayStatsPoint = {
  label: string;
  totalCount: number;
  buildingAverage: number;
};

type WeekdayCountRow = {
  weekday: number;
  totalCount: number;
};

type OpenRoomRow = {
  openRooms: number;
};

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];

function countWeekdayOccurrences(start: Date, end: Date) {
  const counts = Array(7).fill(0);
  const cursor = new Date(start);

  while (cursor < end) {
    const dayIndex = cursor.getUTCDay();
    counts[dayIndex] += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return counts;
}

export async function fetchWeekdayStats(): Promise<WeekdayStatsPoint[]> {
  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 365);

  const [[roomRow], [rows]] = await Promise.all([
    db.execute<OpenRoomRow>(sql`SELECT COUNT(*) AS openRooms FROM client_rooms WHERE open_yn = 1`),
    db.execute<WeekdayCountRow>(sql`
      SELECT DAYOFWEEK(wh.date) AS weekday, COUNT(*) AS totalCount
      FROM work_header wh
      WHERE wh.cleaning_yn = 1
        AND wh.cancel_yn = 0
        AND wh.date >= ${startDate}
        AND wh.date < ${endDate}
      GROUP BY weekday
    `)
  ]);

  const openRooms = Number(roomRow?.openRooms ?? 0);
  const weekdayTotals = new Map<number, number>();
  rows.forEach((row) => {
    weekdayTotals.set(row.weekday, Number(row.totalCount ?? 0));
  });

  const occurrences = countWeekdayOccurrences(startDate, endDate);

  return weekdayLabels.map((label, index) => {
    const mysqlWeekday = index === 0 ? 1 : index + 1; // DAYOFWEEK: 1=Sunday
    const totalCount = weekdayTotals.get(mysqlWeekday) ?? 0;
    const average = occurrences[index] ? totalCount / occurrences[index] : 0;
    const buildingAverage = openRooms ? average / openRooms : 0;

    return { label, totalCount, buildingAverage };
  });
}
