import { and, asc, eq, gte, lte, max } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import { etcBaseCode, etcBuildings, workApply, workerHeader } from '@/src/db/schema';
import { resolveWebActor, withInsertAuditFields } from '@/src/server/audit';

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
export type ApplySectorOption = { codeGroup: string; code: string; label: string };

export async function listApplyRows(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return baseQuery()
    .where(and(gte(workApply.workDate, start), lte(workApply.workDate, end)))
    .orderBy(asc(workApply.workDate), asc(workApply.sectorValue), asc(workApply.id));
}

export async function listApplySectors(): Promise<ApplySectorOption[]> {
  const rows = await db
    .selectDistinct({
      codeGroup: etcBuildings.sectorCode,
      code: etcBuildings.sectorValue,
      label: etcBaseCode.value
    })
    .from(etcBuildings)
    .leftJoin(etcBaseCode, and(eq(etcBaseCode.codeGroup, etcBuildings.sectorCode), eq(etcBaseCode.code, etcBuildings.sectorValue)))
    .orderBy(asc(etcBuildings.sectorCode), asc(etcBuildings.sectorValue));

  return rows.map((row) => ({
    codeGroup: row.codeGroup,
    code: row.code,
    label: row.label || row.code
  }));
}

export async function createApplySlot({
  workDate,
  sectorCode,
  sectorValue,
  position
}: {
  workDate: string;
  sectorCode: string;
  sectorValue: string;
  position: 1 | 2;
}, actor = resolveWebActor()) {
  const date = new Date(`${workDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('잘못된 날짜 형식입니다.');
  }

  const [agg] = await db
    .select({
      maxSeq: max(workApply.seq)
    })
    .from(workApply)
    .where(and(eq(workApply.workDate, date), eq(workApply.sectorCode, sectorCode), eq(workApply.position, position)))
    .limit(1);

  const nextSeq = Number(agg?.maxSeq ?? 0) + 1;
  if (nextSeq > 127) {
    throw new Error('슬롯 번호가 최대치를 초과했습니다. 다른 섹터를 선택해 주세요.');
  }

  const result = await db
    .insert(workApply)
    .values(
      withInsertAuditFields(
        {
          workDate: date,
          sectorCode,
          sectorValue,
          position,
          seq: nextSeq,
          workerId: null
        },
        actor
      )
    );

  const insertedId = (result as { insertId?: number }).insertId ?? null;
  return { id: insertedId, seq: nextSeq, storedDate: date.toISOString().slice(0, 10) };
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
