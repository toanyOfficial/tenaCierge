import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import {
  clientRooms,
  etcBuildings,
  workHeader,
  workerEvaluateHistory,
  workerHeader,
  workerSalaryHistory,
  workerTierRules
} from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import type { ProfileSummary } from '@/src/utils/profile';
import { getTierLabel } from '@/src/utils/tier';
import { formatKstDateKey } from '@/src/lib/time';
import { formatFullDateLabel, getKstNow } from '@/src/utils/workWindow';
import { findWorkerById, findWorkerByProfile, type WorkerRecord } from './workers';

export type EvaluationWorkItem = {
  workId: number;
  roomName: string;
  score: number;
};

export type EvaluationGroup = {
  date: string;
  dateLabel: string;
  comment: string | null;
  works: EvaluationWorkItem[];
};

export type EvaluationPage = {
  groups: EvaluationGroup[];
  nextCursor: string | null;
};

export type EvaluationSummary = {
  totalScore: number;
  recentScore: number;
  rank: number | null;
  percentile: number | null;
  population: number;
  tier: number | null;
  tierLabel: string;
};

export type EvaluationSnapshot = {
  worker: WorkerRecord | null;
  summary: EvaluationSummary | null;
  groups: EvaluationGroup[];
  nextCursor: string | null;
  adminView?: AdminEvaluationView | null;
  message?: string;
};

export type DailyWageRow = {
  workerId: number;
  name: string;
  startTime: Date | null;
  endTime: Date | null;
  tier: number | null;
  tierLabel: string;
  hourlyWage: number | null;
  dailyWage: number | null;
  bank: string | null;
  accountNo: string | null;
  phone: string | null;
};

export type TierChangeRow = {
  workerId: number;
  name: string;
  totalScore: number;
  recentScore: number;
  percentile: number | null;
  tierBefore: number | null;
  tierAfter: number | null;
  tierBeforeLabel: string;
  tierAfterLabel: string;
};

export type AdminEvaluationView = {
  targetDate: string;
  dailyWages: DailyWageRow[];
  tierChanges: TierChangeRow[];
};

const PAGE_SIZE = 5;

export async function resolveEvaluationWorker(
  profile: ProfileSummary,
  requestedWorkerId?: number
): Promise<{ worker: WorkerRecord | null; reason: string | null }> {
  const allowedRoles = ['admin', 'butler', 'cleaner'];
  if (!profile.roles.some((role) => allowedRoles.includes(role))) {
    return { worker: null, reason: '평가 조회 권한이 없습니다.' };
  }

  const viewerWorker = await findWorkerByProfile(profile);
  const isAdmin = profile.roles.includes('admin');
  const targetId = typeof requestedWorkerId === 'number' && !Number.isNaN(requestedWorkerId)
    ? requestedWorkerId
    : viewerWorker?.id ?? null;

  if (!targetId) {
    return {
      worker: null,
      reason: isAdmin ? '근로자를 검색해 선택해 주세요.' : '연결된 근로자 정보를 찾을 수 없습니다.'
    };
  }

  if (!isAdmin && viewerWorker && viewerWorker.id !== targetId) {
    return { worker: null, reason: '다른 근로자의 평가는 조회할 수 없습니다.' };
  }

  const target = await findWorkerById(targetId);
  if (!target) {
    return { worker: null, reason: '해당 근로자 정보를 찾을 수 없습니다.' };
  }

  return { worker: target, reason: null };
}

export async function fetchEvaluationSummary(worker: WorkerRecord): Promise<EvaluationSummary> {
  const now = getKstNow();
  const windowEnd = startOfKstDay(now);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 19);
  const windowNextDay = new Date(windowEnd);
  windowNextDay.setDate(windowNextDay.getDate() + 1);

  const totalRows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
    })
    .from(workerEvaluateHistory)
    .where(eq(workerEvaluateHistory.workerId, worker.id));

  const recentRows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
    })
    .from(workerEvaluateHistory)
    .where(
      and(
        eq(workerEvaluateHistory.workerId, worker.id),
        gte(workerEvaluateHistory.evaluatedAt, windowStart),
        lt(workerEvaluateHistory.evaluatedAt, windowNextDay)
      )
    );

  const populationScores = await db
    .select({
      workerId: workerEvaluateHistory.workerId,
      score: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
    })
    .from(workerEvaluateHistory)
    .where(
      and(
        gte(workerEvaluateHistory.evaluatedAt, windowStart),
        lt(workerEvaluateHistory.evaluatedAt, windowNextDay)
      )
    )
    .groupBy(workerEvaluateHistory.workerId);

  const sorted = populationScores.sort((a, b) => Number(b.score) - Number(a.score));
  const rankIndex = sorted.findIndex((row) => Number(row.workerId) === worker.id);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const population = sorted.length;
  const percentile = rank && population
    ? Number((100 * (1 - (rank - 1) / population)).toFixed(2))
    : null;

  return {
    totalScore: Number(totalRows[0]?.total ?? 0),
    recentScore: Number(recentRows[0]?.total ?? 0),
    rank,
    percentile,
    population,
    tier: typeof worker.tier === 'number' ? worker.tier : null,
    tierLabel: getTierLabel(worker.tier)
  };
}

export async function fetchEvaluationPage(
  workerId: number,
  cursorDate?: string,
  limit = PAGE_SIZE
): Promise<EvaluationPage> {
  const evalDateField = sql<string>`DATE(${workerEvaluateHistory.evaluatedAt})`;
  const whereClause = cursorDate
    ? and(eq(workerEvaluateHistory.workerId, workerId), lt(workerEvaluateHistory.evaluatedAt, buildStart(cursorDate)))
    : eq(workerEvaluateHistory.workerId, workerId);

  const dateRows = await db
    .select({ evalDate: evalDateField })
    .from(workerEvaluateHistory)
    .where(whereClause)
    .groupBy(evalDateField)
    .orderBy(desc(evalDateField))
    .limit(limit + 1);

  const hasMore = dateRows.length > limit;
  const slicedDates = hasMore ? dateRows.slice(0, limit) : dateRows;

  const groups: EvaluationGroup[] = [];
  for (const row of slicedDates) {
    const date = row.evalDate;
    const start = buildStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const entries = await db
      .select({
        id: workerEvaluateHistory.id,
        workId: workerEvaluateHistory.workId,
        score: workerEvaluateHistory.checklistPointSum,
        comment: workerEvaluateHistory.comment,
        evaluatedAt: workerEvaluateHistory.evaluatedAt,
        buildingShortName: etcBuildings.shortName,
        roomNo: clientRooms.roomNo
      })
      .from(workerEvaluateHistory)
      .leftJoin(workHeader, eq(workHeader.id, workerEvaluateHistory.workId))
      .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(
        and(
          eq(workerEvaluateHistory.workerId, workerId),
          gte(workerEvaluateHistory.evaluatedAt, start),
          lt(workerEvaluateHistory.evaluatedAt, end)
        )
      )
      .orderBy(desc(workerEvaluateHistory.evaluatedAt));

    const workMap = new Map<number, EvaluationWorkItem>();
    let dateComment: string | null = null;
    for (const entry of entries) {
      const score = Number(entry.score ?? 0);
      const roomName = buildRoomName(entry.buildingShortName, entry.roomNo);
      const existing = workMap.get(entry.workId);
      if (existing) {
        existing.score += score;
      } else {
        workMap.set(entry.workId, { workId: entry.workId, roomName, score });
      }
      if (!dateComment) {
        const trimmed = (entry.comment ?? '').trim();
        if (trimmed) {
          dateComment = trimmed;
        }
      }
    }

    groups.push({
      date,
      dateLabel: formatFullDateLabel(start),
      comment: dateComment,
      works: Array.from(workMap.values())
    });
  }

  return {
    groups,
    nextCursor: hasMore ? slicedDates[slicedDates.length - 1]?.evalDate ?? null : null
  };
}

export async function getEvaluationSnapshot(
  profile: ProfileSummary,
  requestedWorkerId?: number,
  targetDateStr?: string
): Promise<EvaluationSnapshot> {
  const { worker, reason } = await resolveEvaluationWorker(profile, requestedWorkerId);

  if (!worker) {
    return {
      worker: null,
      summary: null,
      groups: [],
      nextCursor: null,
      message: reason ?? '조회할 근로자가 없습니다.'
    };
  }

  const summary = await fetchEvaluationSummary(worker);
  const page = await fetchEvaluationPage(worker.id);

  let adminView: AdminEvaluationView | null = null;
  if (profile.roles.includes('admin')) {
    try {
      adminView = await fetchAdminEvaluationView(targetDateStr);
    } catch (error) {
      await logServerError({
        appName: 'evaluations-admin',
        message: '관리자 일급/티어 조회 실패',
        error,
        context: { targetDate: targetDateStr ?? undefined }
      });
    }
  }

  return {
    worker,
    summary,
    groups: page.groups,
    nextCursor: page.nextCursor,
    adminView
  };
}

export async function fetchAdminEvaluationView(targetDateStr?: string): Promise<AdminEvaluationView> {
  const targetDate = normalizeTargetDate(targetDateStr);
  const targetKey = toDateKey(targetDate);

  const dailyWages = await fetchDailyWageRows(targetDate);
  const tierChanges = await fetchTierChangeRows(targetDate, dailyWages.map((row) => row.workerId));

  return { targetDate: targetKey, dailyWages, tierChanges };
}

function buildStart(dateKey: string) {
  const safe = `${dateKey}T00:00:00+09:00`;
  const parsed = new Date(safe);
  if (Number.isNaN(parsed.getTime())) {
    return startOfKstDay(getKstNow());
  }
  return parsed;
}

function buildRoomName(shortName?: string | null, roomNo?: string | null) {
  const building = shortName ?? '';
  const room = roomNo ?? '';
  return `${building}${room}`.trim() || '미지정 객실';
}

function startOfKstDay(date: Date) {
  const key = formatKstDateKey(date);
  return new Date(`${key}T00:00:00+09:00`);
}

function toDateKey(date: Date) {
  return formatKstDateKey(date);
}

function normalizeTargetDate(input?: string) {
  const now = getKstNow();
  const todayStart = startOfKstDay(now);
  const defaultDate = getDefaultTargetDate(now);

  if (!input) return defaultDate;

  const parsed = new Date(`${input}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return defaultDate;

  const parsedStart = startOfKstDay(parsed);
  const diffDays = Math.floor((todayStart.getTime() - parsedStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 6) {
    return defaultDate;
  }
  return parsedStart;
}

function getDefaultTargetDate(now: Date) {
  const kstNow = new Date(now);
  const cutoffHour = 16;
  const cutoffMinute = 20;
  const isAfterCutoff =
    kstNow.getHours() > cutoffHour || (kstNow.getHours() === cutoffHour && kstNow.getMinutes() >= cutoffMinute);

  const base = startOfKstDay(kstNow);
  if (isAfterCutoff) return base;

  const previous = new Date(base);
  previous.setDate(previous.getDate() - 1);
  return previous;
}

function chooseDateTime<T extends Date | string | null | undefined>(
  primary?: T | null,
  fallback?: T | null
): Date | null {
  const candidate = primary ?? fallback;
  if (!candidate) return null;
  const parsed = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTimeString(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().substring(11, 19);
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
    if (!match) return null;
    const timePart = match[1];
    return timePart.length === 5 ? `${timePart}:00` : timePart;
  }
  return null;
}

function toKstDateTime(baseDate: Date, timeValue: Date | string | null): Date | null {
  const timeString = toTimeString(timeValue);
  if (!timeString) return null;
  const key = formatKstDateKey(baseDate);
  const candidate = new Date(`${key}T${timeString}+09:00`);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function calculateDailyWage(
  hourlyWageValue: number | string | null,
  start: Date | string | null,
  end: Date | string | null
): number | null {
  const hourlyWage = toNumber(hourlyWageValue);
  const startStr = toTimeString(start);
  const endStr = toTimeString(end);
  if (hourlyWage == null || !startStr || !endStr) return null;

  const toMinutes = (input: string) => {
    const [hh, mm, ss = '0'] = input.split(':');
    return Number(hh) * 60 + Number(mm) + Math.floor(Number(ss) / 60);
  };

  const minutes = toMinutes(endStr) - toMinutes(startStr);
  if (Number.isNaN(minutes) || minutes <= 0) return null;

  return Number(((hourlyWage * minutes) / 60).toFixed(2));
}

async function fetchDailyWageRows(targetDate: Date): Promise<DailyWageRow[]> {
  const rows = await db
    .select({
      workerId: workerSalaryHistory.workerId,
      name: workerHeader.name,
      startTime: workerSalaryHistory.startTime,
      endTime: workerSalaryHistory.endTime,
      hourlyWage: workerSalaryHistory.hourlyWageTargetDate,
      tier: workerHeader.tier,
      bank: workerHeader.bankValue,
      accountNo: workerHeader.accountNo,
      phone: workerHeader.phone
    })
    .from(workerSalaryHistory)
    .innerJoin(workerHeader, eq(workerSalaryHistory.workerId, workerHeader.id))
    .where(eq(workerSalaryHistory.workDate, startOfKstDay(targetDate)))
    .orderBy(workerHeader.name);

  return rows.map((row) => ({
    workerId: Number(row.workerId),
    name: row.name,
    startTime: toKstDateTime(targetDate, row.startTime),
    endTime: toKstDateTime(targetDate, row.endTime),
    tier: typeof row.tier === 'number' ? row.tier : null,
    tierLabel: getTierLabel(row.tier),
    hourlyWage: toNumber(row.hourlyWage),
    dailyWage: calculateDailyWage(row.hourlyWage, row.startTime, row.endTime),
    bank: row.bank ?? null,
    accountNo: row.accountNo ?? null,
    phone: row.phone ?? null
  }));
}

async function fetchTierChangeRows(targetDate: Date, workerIds: number[]): Promise<TierChangeRow[]> {
  if (!workerIds.length) return [];

  const windowEnd = startOfKstDay(targetDate);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 19);
  const windowNextDay = new Date(windowEnd);
  windowNextDay.setDate(windowNextDay.getDate() + 1);

  const [recentRows, totalRows, workers, tierRules] = await Promise.all([
    db
      .select({
        workerId: workerEvaluateHistory.workerId,
        recentScore: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
      })
      .from(workerEvaluateHistory)
      .where(
        and(
          inArray(workerEvaluateHistory.workerId, workerIds),
          gte(workerEvaluateHistory.evaluatedAt, windowStart),
          lt(workerEvaluateHistory.evaluatedAt, windowNextDay)
        )
      )
      .groupBy(workerEvaluateHistory.workerId),
    db
      .select({
        workerId: workerEvaluateHistory.workerId,
        totalScore: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
      })
      .from(workerEvaluateHistory)
      .where(and(inArray(workerEvaluateHistory.workerId, workerIds), lt(workerEvaluateHistory.evaluatedAt, windowNextDay)))
      .groupBy(workerEvaluateHistory.workerId),
    db
      .select({
        workerId: workerHeader.id,
        name: workerHeader.name,
        tier: workerHeader.tier
      })
      .from(workerHeader)
      .where(inArray(workerHeader.id, workerIds)),
    db
      .select({ minPercentage: workerTierRules.minPercentage, maxPercentage: workerTierRules.maxPercentage, tier: workerTierRules.tier })
      .from(workerTierRules)
  ]);

  const recentMap = new Map<number, number>(recentRows.map((row) => [Number(row.workerId), Number(row.recentScore)]));
  const totalMap = new Map<number, number>(totalRows.map((row) => [Number(row.workerId), Number(row.totalScore)]));

  const population = workers
    .filter((worker) => worker.tier != null)
    .map((worker) => ({
      workerId: Number(worker.workerId),
      score: recentMap.get(Number(worker.workerId)) ?? 0
    }))
    .sort((a, b) => Number(b.score) - Number(a.score));

  const percentileMap = new Map<number, number>();
  const n = population.length;
  population.forEach((row, idx) => {
    if (!n) return;
    const percentileTop = ((n - idx) / n) * 100;
    percentileMap.set(row.workerId, percentileTop);
  });

  const orderedRules = tierRules.sort((a, b) => Number(b.maxPercentage) - Number(a.maxPercentage));

  return workers.map((worker) => {
    const workerId = Number(worker.workerId);
    const percentile = percentileMap.get(workerId) ?? null;
    const matchedRule = percentile
      ? orderedRules.find((rule) => percentile >= rule.minPercentage && percentile <= rule.maxPercentage)
      : null;

    return {
      workerId,
      name: worker.name,
      totalScore: totalMap.get(workerId) ?? 0,
      recentScore: recentMap.get(workerId) ?? 0,
      percentile,
      tierBefore: typeof worker.tier === 'number' ? worker.tier : null,
      tierAfter: matchedRule ? matchedRule.tier : null,
      tierBeforeLabel: getTierLabel(worker.tier),
      tierAfterLabel: getTierLabel(matchedRule?.tier ?? null)
    };
  });
}

function toNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}
