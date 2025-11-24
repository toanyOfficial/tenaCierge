import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/src/db/client';
import {
  workChecklistList,
  workChecklistSetDetail,
  workImagesList,
  workImagesSetDetail,
  workImagesSetHeader,
  workReports
} from '@/src/db/schema';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { logServerError } from '@/src/server/errorLogger';

export type SupervisingReportSnapshot = {
  work: CleaningWork;
  cleaningChecklist: ChecklistItem[];
  suppliesChecklist: ChecklistItem[];
  imageSlots: ImageSlot[];
  existingCleaningChecks: number[];
  existingSupplyChecks: number[];
  savedImages: SavedImage[];
};

export type ChecklistItem = {
  id: number;
  title: string;
  type: number;
  score: number;
};

export type ImageSlot = {
  id: number;
  title: string;
  required: boolean;
  comment?: string | null;
};

export type SavedImage = {
  slotId: number;
  url: string;
};

export async function getSupervisingReportSnapshot(
  profile: Awaited<ReturnType<typeof getProfileWithDynamicRoles>>,
  workId?: number | null
) {
  try {
    if (!profile.roles.some((role) => role === 'admin' || role === 'butler')) {
      throw new Error('수퍼바이징 완료보고를 조회할 수 없습니다.');
    }

    if (!workId || Number.isNaN(workId)) {
      throw new Error('work_id가 필요합니다.');
    }

    const workRow = await fetchWorkRowById(workId);

    if (!workRow) {
      throw new Error('해당 업무를 찾을 수 없습니다.');
    }

    if (!workRow.checklistSetId) {
      throw new Error('체크리스트 세트가 지정되지 않았습니다.');
    }

    const checklistRows = await db
      .select({
        id: workChecklistSetDetail.id,
        title: workChecklistSetDetail.title,
        fallbackTitle: workChecklistList.title,
        type: workChecklistList.type,
        score: workChecklistSetDetail.score
      })
      .from(workChecklistSetDetail)
      .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
      .where(and(eq(workChecklistSetDetail.checklistHeaderId, workRow.checklistSetId), inArray(workChecklistList.type, [2, 3])))
      .orderBy(asc(workChecklistList.type), asc(workChecklistSetDetail.seq), asc(workChecklistSetDetail.id));

    const cleaningChecklist = checklistRows
      .filter((item) => item.type === 2)
      .map(({ id, title, fallbackTitle, type, score }) => ({
        id,
        title: title ?? fallbackTitle ?? '',
        type,
        score: Number(score) || 0
      }));

    const suppliesChecklist = checklistRows
      .filter((item) => item.type === 3)
      .map(({ id, title, fallbackTitle, type, score }) => ({
        id,
        title: title ?? fallbackTitle ?? '',
        type,
        score: Number(score) || 0
      }));

    const imageSlots = await (async () => {
      if (!workRow.imagesSetId) return [] as ImageSlot[];

      const rows = await db
        .select({
          id: workImagesSetDetail.id,
          title: workImagesSetDetail.title,
          fallbackTitle: workImagesList.title,
          comment: workImagesSetDetail.comment,
          fallbackComment: workImagesList.comment,
          required: workImagesSetDetail.required,
          role: workImagesSetHeader.role
        })
        .from(workImagesSetDetail)
        .leftJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
        .leftJoin(workImagesSetHeader, eq(workImagesSetDetail.imagesSetId, workImagesSetHeader.id))
        .where(and(eq(workImagesSetDetail.imagesSetId, workRow.imagesSetId), eq(workImagesSetHeader.role, 2)))
        .orderBy(asc(workImagesSetDetail.id));

      return rows.map(({ id, title, fallbackTitle, required, comment, fallbackComment }) => ({
        id,
        title: title ?? fallbackTitle ?? '',
        required: Boolean(required),
        comment: comment ?? fallbackComment ?? null
      }));
    })();

    const reportRows = await db
      .select({ type: workReports.type, contents1: workReports.contents1, contents2: workReports.contents2 })
      .from(workReports)
      .where(eq(workReports.workId, workId))
      .orderBy(desc(workReports.createdAt));

    const latestReports = new Map<number, { contents1: unknown; contents2?: unknown }>();
    for (const row of reportRows) {
      if (!latestReports.has(row.type)) {
        latestReports.set(row.type, { contents1: row.contents1, contents2: row.contents2 });
      }
    }

    const parseIdArray = (value: unknown) => {
      if (!Array.isArray(value)) return [] as number[];
      return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    };

    const rawCleaningChecks = latestReports.get(4)?.contents1 ?? [];
    const rawSupplyChecks = latestReports.get(2)?.contents1 ?? [];

    const savedImages = (() => {
      const rawImages = latestReports.get(5)?.contents1;

      if (!rawImages) return [] as SavedImage[];

      if (Array.isArray(rawImages)) {
        if (rawImages.every((item) => item && typeof item === 'object' && 'slotId' in item && 'url' in item)) {
          return rawImages
            .map((item) => ({
              slotId: Number((item as { slotId: unknown }).slotId),
              url: String((item as { url: unknown }).url)
            }))
            .filter((item) => Number.isFinite(item.slotId) && item.url);
        }

        if (rawImages.every((item) => typeof item === 'string')) {
          return rawImages
            .map((url, idx) => ({ slotId: imageSlots[idx]?.id ?? idx + 1, url }))
            .filter((item) => item.url);
        }
      }

      return [] as SavedImage[];
    })();

    return {
      work: serializeWorkRow(workRow),
      cleaningChecklist,
      suppliesChecklist,
      imageSlots,
      existingCleaningChecks: parseIdArray(rawCleaningChecks),
      existingSupplyChecks: parseIdArray(rawSupplyChecks),
      savedImages
    } satisfies SupervisingReportSnapshot;
  } catch (error) {
    await logServerError({
      appName: 'supervising-report',
      errorCode: 'SNAPSHOT_FAIL',
      message: 'getSupervisingReportSnapshot 실패',
      error
    });
    throw error;
  }
}
