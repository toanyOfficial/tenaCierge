import { and, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workCheckList } from '@/src/db/schema';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { logServerError } from '@/src/server/errorLogger';

export type CleaningReportSnapshot = {
  work: CleaningWork;
  cleaningChecklist: ChecklistItem[];
  suppliesChecklist: ChecklistItem[];
};

export type ChecklistItem = {
  id: number;
  title: string;
  type: number;
  score: number;
};

export async function getCleaningReportSnapshot(
  profile: Awaited<ReturnType<typeof getProfileWithDynamicRoles>>,
  workId?: number | null
) {
  try {
    if (!profile.roles.some((role) => role === 'admin' || role === 'butler' || role === 'cleaner')) {
      throw new Error('접근 권한이 없습니다.');
    }

    if (!workId || Number.isNaN(workId)) {
      throw new Error('work_id가 필요합니다.');
    }

    const workRow = await fetchWorkRowById(workId);

    if (!workRow) {
      throw new Error('해당 업무를 찾을 수 없습니다.');
    }

    const buildingId = workRow.buildingId ?? null;

    const checklistRows = await db
      .select({
        id: workCheckList.id,
        title: workCheckList.title,
        type: workCheckList.type,
        score: workCheckList.score,
        buildingId: workCheckList.buildingId,
        general: workCheckList.generalYn,
        seq: workCheckList.seq
      })
      .from(workCheckList)
      .where(
        and(
          inArray(workCheckList.type, [1, 3]),
          buildingId !== null
            ? or(eq(workCheckList.generalYn, true), eq(workCheckList.buildingId, buildingId))
            : eq(workCheckList.generalYn, true)
        )
      )
      .orderBy(workCheckList.type, workCheckList.seq);

    const cleaningChecklist = checklistRows
      .filter((item) => item.type === 1)
      .map(({ id, title, type, score }) => ({ id, title, type, score }));

    const suppliesChecklist = checklistRows
      .filter((item) => item.type === 3)
      .map(({ id, title, type, score }) => ({ id, title, type, score }));

    return {
      work: serializeWorkRow(workRow),
      cleaningChecklist,
      suppliesChecklist
    } satisfies CleaningReportSnapshot;
  } catch (error) {
    await logServerError({
      appName: 'cleaning-report',
      errorCode: 'SNAPSHOT_FAIL',
      message: 'getCleaningReportSnapshot 실패',
      error
    });
    throw error;
  }
}
