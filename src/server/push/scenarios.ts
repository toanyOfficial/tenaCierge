import { and, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, clientSupplements, etcBuildings, workApply, workHeader, workerHeader, workerTierRules } from '@/src/db/schema';
import { DedupPrefix, buildDedupKey } from '@/src/server/push/dedup';
import { enqueueNotifyJob } from '@/src/server/push/jobs';
import { formatDateKey } from '@/src/utils/workWindow';

type RuleCode =
  | 'CLEAN_SCHEDULE'
  | 'WORK_ASSIGNED'
  | 'WORK_UNASSIGNED'
  | 'WORK_FINISHING'
  | 'SUPPLEMENTS_PENDING'
  | 'WORK_APPLY_OPEN';

type TemplateId = 1 | 2 | 3 | 4 | 5 | 6;

const RULE_CODE: Record<RuleCode, RuleCode> = {
  CLEAN_SCHEDULE: 'CLEAN_SCHEDULE',
  WORK_ASSIGNED: 'WORK_ASSIGNED',
  WORK_UNASSIGNED: 'WORK_UNASSIGNED',
  WORK_FINISHING: 'WORK_FINISHING',
  SUPPLEMENTS_PENDING: 'SUPPLEMENTS_PENDING',
  WORK_APPLY_OPEN: 'WORK_APPLY_OPEN'
};

const TEMPLATE_ID: Record<RuleCode, TemplateId> = {
  CLEAN_SCHEDULE: 1,
  WORK_ASSIGNED: 2,
  WORK_UNASSIGNED: 3,
  WORK_FINISHING: 4,
  SUPPLEMENTS_PENDING: 5,
  WORK_APPLY_OPEN: 6
};

type RoomInfo = { buildingShortName: string; roomNo: string };

type EnqueueResult = { created: number; attempted: number };

function withOffset(date: Date, offsetDays: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

async function resolveRoomInfo(workId: number): Promise<RoomInfo | null> {
  const rows = await db
    .select({
      buildingShortName: etcBuildings.shortName,
      roomNo: clientRooms.roomNo
    })
    .from(workHeader)
    .innerJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .innerJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .where(eq(workHeader.id, workId))
    .limit(1);

  return rows[0] ?? null;
}

export async function queueCleanSchedulePush(params: {
  runDate: Date;
  offsetDays?: number;
  createdBy?: string;
}): Promise<EnqueueResult & { targetDate: string }>
{
  const targetDate = withOffset(params.runDate, params.offsetDays ?? 0);
  const targetKey = formatDateKey(targetDate);

  const rows = await db
    .select({ clientId: clientRooms.clientId, workCount: sql<number>`COUNT(*)` })
    .from(workHeader)
    .innerJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .where(eq(workHeader.date, targetKey))
    .groupBy(clientRooms.clientId);

  let created = 0;
  for (const row of rows) {
    const dedupKey = buildDedupKey(DedupPrefix.CleanSchedule, row.clientId, targetKey);
    const result = await enqueueNotifyJob({
      ruleCode: RULE_CODE.CLEAN_SCHEDULE,
      userType: 'CLIENT',
      userId: row.clientId,
      dedupKey,
      payload: {
        templateId: TEMPLATE_ID.CLEAN_SCHEDULE,
        title: '청소 일정 안내',
        body: `${targetKey} 청소일정 : ${row.workCount}건`
      },
      createdBy: params.createdBy,
      scheduledAt: params.runDate
    });

    if (result.created) created += 1;
  }

  return { created, attempted: rows.length, targetDate: targetKey };
}

export async function queueWorkAssignedPush(params: {
  workId: number;
  workerId: number;
  createdBy?: string;
}): Promise<EnqueueResult>
{
  const roomInfo = await resolveRoomInfo(params.workId);
  const roomLabel = roomInfo ? `${roomInfo.buildingShortName} ${roomInfo.roomNo}호실` : '지정 호실';

  const dedupKey = buildDedupKey(DedupPrefix.WorkAssigned, params.workId, params.workerId);
  const result = await enqueueNotifyJob({
    ruleCode: RULE_CODE.WORK_ASSIGNED,
    userType: 'WORKER',
    userId: params.workerId,
    dedupKey,
    payload: {
      templateId: TEMPLATE_ID.WORK_ASSIGNED,
      title: '청소 배정 안내',
      body: `${roomLabel}에 클리닝이 배정되었습니다.`
    },
    createdBy: params.createdBy
  });

  return { created: result.created ? 1 : 0, attempted: 1 };
}

export async function queueWorkUnassignedPush(params: {
  workId: number;
  workerId: number;
  createdBy?: string;
}): Promise<EnqueueResult>
{
  const roomInfo = await resolveRoomInfo(params.workId);
  const roomLabel = roomInfo ? `${roomInfo.buildingShortName} ${roomInfo.roomNo}호실` : '지정 호실';

  const dedupKey = buildDedupKey(DedupPrefix.WorkUnassigned, params.workId, params.workerId);
  const result = await enqueueNotifyJob({
    ruleCode: RULE_CODE.WORK_UNASSIGNED,
    userType: 'WORKER',
    userId: params.workerId,
    dedupKey,
    payload: {
      templateId: TEMPLATE_ID.WORK_UNASSIGNED,
      title: '배정 해제 안내',
      body: `${roomLabel}에 클리닝 배정이 해제되었습니다.`
    },
    createdBy: params.createdBy
  });

  return { created: result.created ? 1 : 0, attempted: 1 };
}

export async function queueWorkFinishingPush(params: {
  workId: number;
  butlerIds: number[];
  createdBy?: string;
}): Promise<EnqueueResult>
{
  if (!params.butlerIds.length) {
    return { created: 0, attempted: 0 };
  }

  const roomInfo = await resolveRoomInfo(params.workId);
  const roomLabel = roomInfo ? `${roomInfo.buildingShortName} ${roomInfo.roomNo}호실` : '지정 호실';

  let created = 0;
  for (const butlerId of params.butlerIds) {
    const dedupKey = buildDedupKey(DedupPrefix.WorkFinishing, params.workId, butlerId);
    const result = await enqueueNotifyJob({
      ruleCode: RULE_CODE.WORK_FINISHING,
      userType: 'WORKER',
      userId: butlerId,
      dedupKey,
      payload: {
        templateId: TEMPLATE_ID.WORK_FINISHING,
        title: '청소 완료 안내',
        body: `${roomLabel}이 마무리 단계입니다.`
      },
      createdBy: params.createdBy
    });

    if (result.created) created += 1;
  }

  return { created, attempted: params.butlerIds.length };
}

export async function queueSupplementsPendingPush(params: { today?: Date; createdBy?: string }): Promise<EnqueueResult>
{
  const today = params.today ?? new Date();
  const todayKey = formatDateKey(today);

  const rows = await db
    .select({ clientId: clientRooms.clientId, pendingCount: sql<number>`COUNT(*)` })
    .from(clientSupplements)
    .innerJoin(clientRooms, eq(clientSupplements.roomId, clientRooms.id))
    .where(eq(clientSupplements.buyYn, false))
    .groupBy(clientRooms.clientId);

  let created = 0;
  for (const row of rows) {
    const dedupKey = buildDedupKey(DedupPrefix.SupplementsPending, row.clientId, todayKey);
    const result = await enqueueNotifyJob({
      ruleCode: RULE_CODE.SUPPLEMENTS_PENDING,
      userType: 'CLIENT',
      userId: row.clientId,
      dedupKey,
      payload: {
        templateId: TEMPLATE_ID.SUPPLEMENTS_PENDING,
        title: '소모품 안내',
        body: `총 ${row.pendingCount}개의 소모품을 구매 해야 합니다. 빠른 구매 부탁드립니다`
      },
      createdBy: params.createdBy
    });

    if (result.created) created += 1;
  }

  return { created, attempted: rows.length };
}

export async function queueWorkApplyOpenPush(params: {
  today?: Date;
  horizonDays?: number;
  createdBy?: string;
}): Promise<EnqueueResult & { openCount: number }>
{
  const today = params.today ?? new Date();
  const horizonDays = params.horizonDays ?? 7;
  const todayKey = formatDateKey(today);
  const endKey = formatDateKey(withOffset(today, horizonDays));

  const [openRow] = await db
    .select({ openCount: sql<number>`COUNT(*)` })
    .from(workApply)
    .where(and(isNull(workApply.workerId), gte(workApply.workDate, todayKey), lte(workApply.workDate, endKey)));

  const openCount = openRow?.openCount ?? 0;
  if (openCount === 0) {
    return { created: 0, attempted: 0, openCount: 0 };
  }

  const tierRules = await db.select({ tier: workerTierRules.tier, applyStartTime: workerTierRules.applyStartTime }).from(workerTierRules);
  const tierRuleMap = new Map<number, string | null>();
  tierRules.forEach((rule) => tierRuleMap.set(rule.tier, rule.applyStartTime));

  const workers = await db
    .select({ id: workerHeader.id, tier: workerHeader.tier })
    .from(workerHeader)
    .where(ne(workerHeader.tier, 1));

  let created = 0;
  for (const worker of workers) {
    const startTime = tierRuleMap.get(worker.tier) ?? null;
    const timeLabel = startTime ? startTime.slice(0, 5) : '--:--';
    const dedupKey = buildDedupKey(DedupPrefix.WorkApplyOpen, worker.id, todayKey);
    const result = await enqueueNotifyJob({
      ruleCode: RULE_CODE.WORK_APPLY_OPEN,
      userType: 'WORKER',
      userId: worker.id,
      dedupKey,
      payload: {
        templateId: TEMPLATE_ID.WORK_APPLY_OPEN,
        title: '업무 신청 안내',
        body: `현재 ${openCount}건의 업무가 남아있습니다 ${timeLabel}부터 신청 가능합니다.`
      },
      createdBy: params.createdBy
    });

    if (result.created) created += 1;
  }

  return { created, attempted: workers.length, openCount };
}
