import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import { etcBaseCode, workApply, workerHeader } from '@/src/db/schema';

const applicantWorker = alias(workerHeader, 'applyWorker');

const selection = {
  id: workApply.id,
  workDate: workApply.workDate,
  sectorCode: workApply.sectorCode,
  sectorValue: workApply.sectorValue,
  sectorName: etcBaseCode.value,
  seq: workApply.seq,
  position: workApply.position,
  workerId: workApply.workerId,
  workerName: applicantWorker.name,
  workerTier: applicantWorker.tier
};

export type ApplyRow = Awaited<ReturnType<typeof listApplyRows>>[number];

export async function listApplyRows(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  return baseQuery()
    .where(and(gte(workApply.workDate, start), lte(workApply.workDate, end)))
    .orderBy(asc(workApply.workDate), asc(workApply.sectorValue), asc(workApply.id));
}

export async function getApplyRowById(applyId: number) {
  const rows = await baseQuery().where(eq(workApply.id, applyId)).limit(1);

  return rows[0] ?? null;
}

function baseQuery() {
  return db
    .select(selection)
    .from(workApply)
    .leftJoin(applicantWorker, eq(workApply.workerId, applicantWorker.id))
    .leftJoin(
      etcBaseCode,
      and(eq(etcBaseCode.codeGroup, workApply.sectorCode), eq(etcBaseCode.code, workApply.sectorValue))
    );
}
