import { sql } from 'drizzle-orm';

import { db } from '@/src/db/client';

export type MonthlyAveragePoint = {
  label: string;
  perOrderCount: number;
  subscriptionCount: number;
};

type MonthlyPlanRow = {
  month: string;
  settleFlag: number;
  totalCount: number;
};

type PlanRoomRow = {
  settleFlag: number;
  roomCount: number;
};

function formatMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}-01`;
}

async function resolveAnchorMonth() {
  const [rows] = await db.execute<{ lastMonth: string | null }>(sql`
    SELECT DATE_FORMAT(MAX(wh.date), '%Y-%m-01') AS lastMonth
    FROM work_header wh
    WHERE wh.cleaning_yn = 1
      AND wh.cancel_yn = 0
  `);

  const lastMonth = rows[0]?.lastMonth;
  if (lastMonth) {
    return new Date(`${lastMonth}T00:00:00.000Z`);
  }

  const fallback = new Date();
  fallback.setUTCDate(1);
  return fallback;
}

function getTrailingMonths(anchor: Date) {
  const months: { key: string; label: string }[] = [];

  for (let offset = 12; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1));
    months.push({
      key: formatMonthKey(cursor),
      label: `${cursor.getUTCMonth() + 1}`.padStart(2, '0')
    });
  }

  return months;
}

export async function fetchMonthlyAverages(): Promise<MonthlyAveragePoint[]> {
  const anchor = await resolveAnchorMonth();
  const months = getTrailingMonths(anchor);
  const startDate = months[0]?.key;
  const endCursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const endDate = formatMonthKey(endCursor);

  const [rows] = await db.execute<MonthlyPlanRow>(sql`
    SELECT
      DATE_FORMAT(wh.date, '%Y-%m-01') AS month,
      ch.settle_flag AS settleFlag,
      COUNT(*) AS totalCount
    FROM work_header wh
      INNER JOIN client_rooms cr ON wh.room_id = cr.id
      INNER JOIN client_header ch ON cr.client_id = ch.id
    WHERE wh.cleaning_yn = 1
      AND wh.cancel_yn = 0
      AND ch.settle_flag IN (1, 2)
      AND wh.date >= ${startDate}
      AND wh.date < ${endDate}
    GROUP BY month, ch.settle_flag
  `);

  const [planRooms] = await db.execute<PlanRoomRow>(sql`
    SELECT
      ch.settle_flag AS settleFlag,
      COUNT(*) AS roomCount
    FROM client_rooms cr
      INNER JOIN client_header ch ON cr.client_id = ch.id
    WHERE cr.open_yn = 1
      AND ch.settle_flag IN (1, 2)
    GROUP BY ch.settle_flag
  `);

  const planRoomCounts = planRooms.reduce(
    (acc, row) => {
      if (row.settleFlag === 1) {
        acc.perOrder = Number(row.roomCount ?? 0);
      }
      if (row.settleFlag === 2) {
        acc.subscription = Number(row.roomCount ?? 0);
      }
      return acc;
    },
    { perOrder: 0, subscription: 0 }
  );

  const groupedTotals = new Map<string, { perOrder: number; subscription: number }>();
  rows.forEach((row) => {
    const monthTotals = groupedTotals.get(row.month) ?? { perOrder: 0, subscription: 0 };
    if (row.settleFlag === 1) {
      monthTotals.perOrder = Number(row.totalCount ?? 0);
    }
    if (row.settleFlag === 2) {
      monthTotals.subscription = Number(row.totalCount ?? 0);
    }
    groupedTotals.set(row.month, monthTotals);
  });

  return months.map(({ key, label }) => {
    const totals = groupedTotals.get(key) ?? { perOrder: 0, subscription: 0 };
    const perOrderRoomCount = planRoomCounts.perOrder || 0;
    const subscriptionRoomCount = planRoomCounts.subscription || 0;
    const perOrderAverage = perOrderRoomCount ? totals.perOrder / perOrderRoomCount : 0;
    const subscriptionAverage = subscriptionRoomCount ? totals.subscription / subscriptionRoomCount : 0;

    return {
      label,
      perOrderCount: perOrderAverage,
      subscriptionCount: subscriptionAverage
    };
  });
}
