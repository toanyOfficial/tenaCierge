import { and, eq, lte } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workerPenaltyHistory } from '@/src/db/schema';
import { formatDateKey } from '@/src/utils/workWindow';

type PenaltyWindow = {
  active: boolean;
  start?: string;
  end?: string;
};

export async function getActivePenalty(workerId: number, today: Date): Promise<PenaltyWindow> {
  if (!workerId) {
    return { active: false };
  }

  const todayKey = formatDateKey(today);
  const base = new Date(`${todayKey}T00:00:00+09:00`);

  const rows = await db
    .select({ startDate: workerPenaltyHistory.startDate, interval: workerPenaltyHistory.interval })
    .from(workerPenaltyHistory)
    .where(and(eq(workerPenaltyHistory.workerId, workerId), lte(workerPenaltyHistory.startDate, base)));

  for (const row of rows) {
    const start = normalizeDate(row.startDate);
    if (!start) continue;

    const intervalDays = Math.max(Number(row.interval) || 0, 1);
    const end = new Date(start);
    end.setDate(end.getDate() + intervalDays - 1);

    if (base >= start && base <= end) {
      return { active: true, start: formatDateKey(start), end: formatDateKey(end) };
    }
  }

  return { active: false };
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}
