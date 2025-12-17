import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyAveragePoint = {
  label: string;
  perOrder: number;
  subscription: number;
};

type MonthlyAverageRow = {
  month: string;
  settleFlag: number;
  averageCount: number;
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

  const [rows] = await db.execute<MonthlyAverageRow>(sql`
    SELECT month, settleFlag, AVG(monthly_room_count) AS averageCount
    FROM (
      SELECT
        DATE_FORMAT(wh.date, '%Y-%m-01') AS month,
        ch.settle_flag AS settleFlag,
        wh.room_id AS roomId,
        COUNT(*) AS monthly_room_count
      FROM work_header wh
      JOIN client_rooms cr ON cr.id = wh.room_id
      JOIN client_header ch ON ch.id = cr.client_id
      WHERE wh.cleaning_yn = 1
        AND wh.cancel_yn = 0
        AND ch.settle_flag IN (1, 2)
        AND wh.date >= ${startDate}
        AND wh.date < ${endDate}
      GROUP BY month, settleFlag, roomId
    ) AS room_monthly_counts
    GROUP BY month, settleFlag
  `);

  const grouped = new Map<string, { perOrder: number; subscription: number }>();

  rows.forEach((row) => {
    const settleFlag = Number(row.settleFlag);
    const entry = grouped.get(row.month) ?? { perOrder: 0, subscription: 0 };
    if (settleFlag === 1) {
      entry.perOrder = Number(row.averageCount ?? 0);
    }
    if (settleFlag === 2) {
      entry.subscription = Number(row.averageCount ?? 0);
    }
    grouped.set(row.month, entry);
  });

  return months.map(({ key, label }) => {
    const entry = grouped.get(key) ?? { perOrder: 0, subscription: 0 };

    return {
      label,
      perOrder: entry.perOrder,
      subscription: entry.subscription
    };
  });
}
