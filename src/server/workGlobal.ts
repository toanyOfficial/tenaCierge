import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { db } from '@/src/db/client';
import { clientRooms, etcBaseCode, etcBuildings, workGlobalDetail, workGlobalHeader } from '@/src/db/schema';
import { formatKstDateKey, nowKst } from '@/src/lib/time';

export type WorkGlobalHeaderRecord = {
  id: number;
  emoji: string | null;
  title: string;
  dscpt: string;
  startDate: string;
  endDate: string | null;
  remainQty: number;
  closedYn: boolean;
  comment: string | null;
};

export type WorkGlobalReportRoom = {
  roomId: number;
  sector: string;
  buildingShortName: string;
  roomNo: string;
  completedAt: string | null;
};

export type WorkGlobalReport = {
  reportDate: string;
  header: WorkGlobalHeaderRecord;
  totalRooms: number;
  completedRooms: number;
  completionRate: number;
  sectorRemainings: { sector: string; remaining: number }[];
  rooms: WorkGlobalReportRoom[];
};

type HeaderPayload = {
  emoji?: string | null;
  title: string;
  dscpt: string;
  startDate: string;
  endDate?: string | null;
  remainQty: number;
  closedYn: boolean;
  comment?: string | null;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('잘못된 날짜 형식입니다.');
  }
  return parsed;
}

function mapHeaderRow(row: {
  id: number;
  emoji: string | null;
  title: string;
  dscpt: string;
  startDate: Date;
  endDate: Date | null;
  remainQty: number;
  closedYn: number | boolean;
  comment: string | null;
}): WorkGlobalHeaderRecord {
  return {
    id: Number(row.id),
    emoji: row.emoji,
    title: row.title,
    dscpt: row.dscpt,
    startDate: formatKstDateKey(row.startDate),
    endDate: row.endDate ? formatKstDateKey(row.endDate) : null,
    remainQty: Number(row.remainQty),
    closedYn: Boolean(row.closedYn),
    comment: row.comment
  };
}

export async function listWorkGlobalHeaders() {
  const rows = await db
    .select({
      id: workGlobalHeader.id,
      emoji: workGlobalHeader.emoji,
      title: workGlobalHeader.title,
      dscpt: workGlobalHeader.dscpt,
      startDate: workGlobalHeader.startDate,
      endDate: workGlobalHeader.endDate,
      remainQty: workGlobalHeader.remainQty,
      closedYn: workGlobalHeader.closedYn,
      comment: workGlobalHeader.comment
    })
    .from(workGlobalHeader)
    .orderBy(desc(workGlobalHeader.startDate), desc(workGlobalHeader.id));

  return rows.map(mapHeaderRow);
}

export async function getWorkGlobalHeader(id: number) {
  const [row] = await db
    .select({
      id: workGlobalHeader.id,
      emoji: workGlobalHeader.emoji,
      title: workGlobalHeader.title,
      dscpt: workGlobalHeader.dscpt,
      startDate: workGlobalHeader.startDate,
      endDate: workGlobalHeader.endDate,
      remainQty: workGlobalHeader.remainQty,
      closedYn: workGlobalHeader.closedYn,
      comment: workGlobalHeader.comment
    })
    .from(workGlobalHeader)
    .where(eq(workGlobalHeader.id, id))
    .limit(1);

  return row ? mapHeaderRow(row) : null;
}

export async function createWorkGlobalHeader(payload: HeaderPayload) {
  const startDate = parseDate(payload.startDate);
  if (!startDate) {
    throw new Error('시작일을 입력해 주세요.');
  }

  const endDate = parseDate(payload.endDate);

  const result = await db.insert(workGlobalHeader).values({
    emoji: payload.emoji ?? null,
    title: payload.title,
    dscpt: payload.dscpt,
    startDate,
    endDate,
    remainQty: payload.remainQty,
    closedYn: payload.closedYn,
    comment: payload.comment ?? null
  });

  const insertedId = (result as { insertId?: number }).insertId ?? null;
  if (!insertedId) {
    return listWorkGlobalHeaders();
  }

  return listWorkGlobalHeaders();
}

export async function updateWorkGlobalHeader(id: number, payload: HeaderPayload) {
  const startDate = parseDate(payload.startDate);
  if (!startDate) {
    throw new Error('시작일을 입력해 주세요.');
  }

  const endDate = parseDate(payload.endDate);

  await db
    .update(workGlobalHeader)
    .set({
      emoji: payload.emoji ?? null,
      title: payload.title,
      dscpt: payload.dscpt,
      startDate,
      endDate,
      remainQty: payload.remainQty,
      closedYn: payload.closedYn,
      comment: payload.comment ?? null
    })
    .where(eq(workGlobalHeader.id, id));

  return listWorkGlobalHeaders();
}

export async function fetchWorkGlobalReport(workGlobalId: number): Promise<WorkGlobalReport> {
  const header = await getWorkGlobalHeader(workGlobalId);
  if (!header) {
    throw new Error('대상 업무를 찾을 수 없습니다.');
  }

  const workGlobalDate = parseDate(header.startDate);
  if (!workGlobalDate) {
    throw new Error('업무 시작일이 올바르지 않습니다.');
  }

  const buildingSector = alias(etcBaseCode, 'buildingSector');

  const rows = await db
    .select({
      roomId: clientRooms.id,
      sector: buildingSector.value,
      buildingShortName: etcBuildings.shortName,
      roomNo: clientRooms.roomNo,
      completedAt: sql<Date | null>`MIN(${workGlobalDetail.createdAt})`
    })
    .from(clientRooms)
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      buildingSector,
      and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
    )
    .leftJoin(
      workGlobalDetail,
      and(eq(workGlobalDetail.workGlobalId, workGlobalDate), eq(workGlobalDetail.roomId, clientRooms.id))
    )
    .where(eq(clientRooms.openYn, true))
    .groupBy(clientRooms.id, buildingSector.value, etcBuildings.shortName, clientRooms.roomNo)
    .orderBy(asc(buildingSector.value), desc(etcBuildings.shortName), desc(clientRooms.roomNo));

  const buildingCounts = rows.reduce<Map<string, number>>((acc, row) => {
    const key = row.buildingShortName ?? '';
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  const sortedRooms = [...rows].sort((a, b) => {
    const sectorA = a.sector ?? '';
    const sectorB = b.sector ?? '';
    if (sectorA !== sectorB) return sectorA.localeCompare(sectorB);

    const countA = buildingCounts.get(a.buildingShortName ?? '') ?? 0;
    const countB = buildingCounts.get(b.buildingShortName ?? '') ?? 0;
    if (countA !== countB) return countB - countA;

    const buildingNameComp = (a.buildingShortName ?? '').localeCompare(b.buildingShortName ?? '');
    if (buildingNameComp !== 0) return buildingNameComp;

    return (b.roomNo ?? '').localeCompare(a.roomNo ?? '');
  });

  const rooms: WorkGlobalReportRoom[] = sortedRooms.map((row) => ({
    roomId: Number(row.roomId),
    sector: row.sector ?? '미정',
    buildingShortName: row.buildingShortName ?? 'N/A',
    roomNo: row.roomNo ?? '-',
    completedAt: row.completedAt ? formatKstDateKey(row.completedAt) : null
  }));

  const totalRooms = rooms.length;
  const completedRooms = rooms.filter((room) => room.completedAt).length;
  const completionRate = totalRooms ? Math.round((completedRooms / totalRooms) * 100) : 0;

  const sectorRemainings = rooms.reduce<Map<string, number>>((acc, room) => {
    if (room.completedAt) return acc;
    acc.set(room.sector, (acc.get(room.sector) ?? 0) + 1);
    return acc;
  }, new Map());

  const sectorRemainingsArray = Array.from(sectorRemainings.entries())
    .map(([sector, remaining]) => ({ sector, remaining }))
    .sort((a, b) => a.sector.localeCompare(b.sector));

  return {
    reportDate: nowKst().toISODate(),
    header,
    totalRooms,
    completedRooms,
    completionRate,
    sectorRemainings: sectorRemainingsArray,
    rooms
  };
}

export async function markWorkGlobalDetailComplete(workGlobalId: number, roomId: number) {
  const header = await getWorkGlobalHeader(workGlobalId);
  if (!header) {
    throw new Error('대상 업무를 찾을 수 없습니다.');
  }

  const workGlobalDate = parseDate(header.startDate);
  if (!workGlobalDate) {
    throw new Error('업무 시작일이 올바르지 않습니다.');
  }

  const [existing] = await db
    .select({ id: workGlobalDetail.id, createdAt: workGlobalDetail.createdAt })
    .from(workGlobalDetail)
    .where(and(eq(workGlobalDetail.workGlobalId, workGlobalDate), eq(workGlobalDetail.roomId, roomId)))
    .limit(1);

  if (existing) {
    return formatKstDateKey(existing.createdAt);
  }

  const now = nowKst().toJSDate();
  await db
    .insert(workGlobalDetail)
    .values({ workGlobalId: workGlobalDate, roomId, createdAt: now, updatedAt: now });

  return formatKstDateKey(now);
}

export async function revertWorkGlobalDetail(workGlobalId: number, roomId: number) {
  const header = await getWorkGlobalHeader(workGlobalId);
  if (!header) {
    throw new Error('대상 업무를 찾을 수 없습니다.');
  }

  const workGlobalDate = parseDate(header.startDate);
  if (!workGlobalDate) {
    throw new Error('업무 시작일이 올바르지 않습니다.');
  }

  await db
    .delete(workGlobalDetail)
    .where(and(eq(workGlobalDetail.workGlobalId, workGlobalDate), eq(workGlobalDetail.roomId, roomId)));
}
