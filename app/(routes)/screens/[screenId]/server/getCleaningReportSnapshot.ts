import { asc, inArray } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workChecklistList } from '@/src/db/schema';
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

    const checklistRows = await db
      .select({
        id: workChecklistList.id,
        title: workChecklistList.title,
        type: workChecklistList.type
      })
      .from(workChecklistList)
      .where(inArray(workChecklistList.type, [1, 3]))
      .orderBy(asc(workChecklistList.type), asc(workChecklistList.id));

    const cleaningChecklist = checklistRows
      .filter((item) => item.type === 1)
      .map(({ id, title, type }) => ({ id, title, type, score: 0 }));

    const suppliesChecklist = checklistRows
      .filter((item) => item.type === 3)
      .map(({ id, title, type }) => ({ id, title, type, score: 0 }));

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
