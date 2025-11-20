import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientRooms, etcBuildings, workApply, workHeader, workerHeader } from '@/src/db/schema';

const cleanerWorker = workerHeader.as('applyCleaner');
const butlerWorker = workerHeader.as('applyButler');

const selection = {
  id: workApply.id,
  workId: workApply.workId,
  workDate: workApply.workDate,
  butlerYn: workApply.butlerYn,
  sectorCode: workApply.sectorCode,
  sectorValue: workApply.sectorValue,
  buildingSector: etcBuildings.sectorLabel,
  buildingName: etcBuildings.buildingName,
  buildingShortName: etcBuildings.shortName,
  cleanerId: workHeader.cleanerId,
  cleanerName: cleanerWorker.name,
  cleanerTier: cleanerWorker.tier,
  butlerId: workHeader.butlerId,
  butlerName: butlerWorker.name,
  butlerTier: butlerWorker.tier
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
    .orderBy(asc(workApply.workDate), asc(etcBuildings.sectorLabel), asc(workApply.id));
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
    .leftJoin(workHeader, eq(workApply.workId, workHeader.id))
    .leftJoin(clientRooms, eq(workHeader.room, clientRooms.id))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(cleanerWorker, eq(workHeader.cleanerId, cleanerWorker.id))
    .leftJoin(butlerWorker, eq(workHeader.butlerId, butlerWorker.id));
}
