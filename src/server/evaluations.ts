import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBuildings, workHeader, workerEvaluateHistory } from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
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
};

export type EvaluationSnapshot = {
  worker: WorkerRecord | null;
  summary: EvaluationSummary | null;
  groups: EvaluationGroup[];
  nextCursor: string | null;
  message?: string;
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

export async function fetchEvaluationSummary(workerId: number): Promise<EvaluationSummary> {
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
    .where(eq(workerEvaluateHistory.workerId, workerId));

  const recentRows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${workerEvaluateHistory.checklistPointSum}), 0)`
    })
    .from(workerEvaluateHistory)
    .where(
      and(
        eq(workerEvaluateHistory.workerId, workerId),
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
    .where(and(gte(workerEvaluateHistory.evaluatedAt, windowStart), lt(workerEvaluateHistory.evaluatedAt, windowNextDay)))
    .groupBy(workerEvaluateHistory.workerId);

  const sorted = populationScores.sort((a, b) => Number(b.score) - Number(a.score));
  const rankIndex = sorted.findIndex((row) => Number(row.workerId) === workerId);
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
    population
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
  requestedWorkerId?: number
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

  const summary = await fetchEvaluationSummary(worker.id);
  const page = await fetchEvaluationPage(worker.id);

  return {
    worker,
    summary,
    groups: page.groups,
    nextCursor: page.nextCursor
  };
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
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
