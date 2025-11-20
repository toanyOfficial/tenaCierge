import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import { workApply, workerHeader } from '@/src/db/schema';

const applicantWorker = alias(workerHeader, 'applyWorker');

const selection = {
  id: workApply.id,
  workDate: workApply.workDate,
  butlerYn: workApply.butlerYn,
  sectorCode: workApply.sectorCode,
  sectorValue: workApply.sectorValue,
  workerId: workApply.workerId,
  workerName: applicantWorker.name,
  workerTier: applicantWorker.tier
};

export type ApplyRow = Awaited<ReturnType<typeof listApplyRows>>[number];

export async function listApplyRows(startDate: string, endDate: string) {
  return baseQuery()
    .where(
      and(
        eq(workApply.cancelYn, false),
        gte(workApply.workDate, startDate),
        lte(workApply.workDate, endDate)
      )
    )
    .orderBy(asc(workApply.workDate), asc(workApply.sectorValue), asc(workApply.id));
}

export async function getApplyRowById(applyId: number) {
  const rows = await baseQuery()
    .where(and(eq(workApply.cancelYn, false), eq(workApply.id, applyId)))
    .limit(1);

  return rows[0] ?? null;
}

function baseQuery() {
  return db
    .select(selection)
    .from(workApply)
    .leftJoin(applicantWorker, eq(workApply.workerId, applicantWorker.id));
}
