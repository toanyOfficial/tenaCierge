import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import {
  workChecklistList,
  workChecklistSetDetail,
  workImagesList,
  workImagesSetDetail,
  workReports
} from '@/src/db/schema';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { logServerError } from '@/src/server/errorLogger';

export type CleaningReportSnapshot = {
  work: CleaningWork;
  cleaningChecklist: ChecklistItem[];
  suppliesChecklist: ChecklistItem[];
  imageSlots: ImageSlot[];
  existingCleaningChecks: number[];
  existingSupplyChecks: number[];
  existingSupplyNotes: Record<number, string>;
  savedImages: SavedImage[];
};

export type ChecklistItem = {
  id: number;
  title: string;
  type: number;
  score: number;
  description: string | null;
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

export async function getCleaningReportSnapshot(
  profile: Awaited<ReturnType<typeof getProfileWithDynamicRoles>>,
  workId?: number | null
) {
  try {
  if (!profile.roles.some((role) => role === 'admin' || role === 'butler' || role === 'cleaner')) {
      throw new Error('청소완료보고를 조회할 수 없는 역할입니다.');
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

    const [checklistRows, supplyRows] = await Promise.all([
      db
        .select({
          id: workChecklistSetDetail.id,
          title: workChecklistSetDetail.title,
          fallbackTitle: workChecklistList.title,
          description: workChecklistSetDetail.description,
          fallbackDescription: workChecklistList.description,
          type: workChecklistList.type,
          score: workChecklistSetDetail.score
        })
        .from(workChecklistSetDetail)
        .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
        .where(and(eq(workChecklistSetDetail.checklistHeaderId, workRow.checklistSetId), eq(workChecklistList.type, 1)))
        .orderBy(
          asc(sql`COALESCE(${workChecklistSetDetail.ordering}, ${workChecklistList.ordering})`),
          asc(workChecklistSetDetail.id)
        ),
      db
        .select({ id: workChecklistList.id, title: workChecklistList.title, description: workChecklistList.description })
        .from(workChecklistList)
        .where(eq(workChecklistList.type, 3))
        .orderBy(asc(sql`COALESCE(${workChecklistList.ordering}, ${workChecklistList.id})`))
    ]);

    const cleaningChecklist = checklistRows
      .filter((item) => item.type === 1)
      .map(({ id, title, fallbackTitle, type, score, description, fallbackDescription }) => ({
        id,
        title: title ?? fallbackTitle ?? '',
        type: Number(type ?? 0),
        score: Number(score) || 0,
        description: description ?? fallbackDescription ?? null
      }));

    const suppliesChecklist = sortSuppliesWithDescriptionLast(
      supplyRows.map(({ id, title, description }) => ({
        id,
        title: title ?? '',
        type: 3,
        score: 0,
        description: description ?? null
      }))
    );

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
          listRequired: workImagesList.required
        })
        .from(workImagesSetDetail)
        .leftJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
        .where(and(eq(workImagesSetDetail.imagesSetId, workRow.imagesSetId), eq(workImagesList.role, 1)))
        .orderBy(
          asc(sql`COALESCE(${workImagesSetDetail.ordering}, ${workImagesList.ordering})`),
          asc(workImagesSetDetail.id)
        );

      return rows.map(({ id, title, fallbackTitle, required, listRequired, comment, fallbackComment }) => ({
        id,
        title: title ?? fallbackTitle ?? '',
        required: Boolean(required ?? listRequired),
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

    const parseSupplyNotes = (value: unknown) => {
      if (!value || typeof value !== 'object') return {} as Record<number, string>;

      if (Array.isArray(value)) {
        return value.reduce((acc, entry, idx) => {
          const normalized = typeof entry === 'string' ? entry.trim() : '';
          if (normalized) {
            acc[idx + 1] = normalized;
          }
          return acc;
        }, {} as Record<number, string>);
      }

      return Object.entries(value as Record<string, unknown>).reduce((acc, [key, val]) => {
        const note = typeof val === 'string' ? val.trim() : '';
        const numericKey = Number.parseInt(key, 10);
        if (note && Number.isFinite(numericKey)) {
          acc[numericKey] = note;
        }
        return acc;
      }, {} as Record<number, string>);
    };

    const rawCleaningChecks = latestReports.get(1)?.contents1 ?? [];
    const rawSupplyChecks = latestReports.get(2)?.contents1 ?? [];
    const rawSupplyNotes = latestReports.get(2)?.contents2 ?? {};

    const savedImages = (() => {
      const rawImages = latestReports.get(3)?.contents1;

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
      existingSupplyNotes: parseSupplyNotes(rawSupplyNotes),
      savedImages
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

function sortSuppliesWithDescriptionLast<T extends { description: string | null }>(supplies: T[]) {
  return supplies.slice().sort((a, b) => {
    const aNull = !a.description;
    const bNull = !b.description;
    if (aNull === bNull) return 0;
    return aNull ? 1 : -1;
  });
}
