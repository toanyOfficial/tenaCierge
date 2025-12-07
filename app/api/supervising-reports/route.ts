import path from 'path';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import {
  workChecklistList,
  workChecklistSetDetail,
  workHeader,
  workImagesList,
  workImagesSetDetail,
  workReports,
  workerEvaluateHistory
} from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById } from '@/src/server/workQueries';
import { processImageUploads, UploadError } from '@/src/server/imageUpload';
import { getKstNow } from '@/src/utils/workWindow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const profile = await getProfileWithDynamicRoles();

  if (!profile.roles.some((role) => role === 'admin' || role === 'butler')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const workId = Number(form.get('workId'));
    const mode = form.get('mode');
    const isDraft = mode === 'draft';
    const supervisingFindings = safeParseChecklistFlags(form.get('supervisingFindings'));
    const supervisingCompletion = safeParseChecklistFlags(form.get('supervisingCompletion'));
    const supervisingComment = safeParseComment(form.get('supervisingComment'));
    const supplyChecks = safeParseIds(form.get('supplyChecks'));
    const supplyNotes = safeParseSupplyNotes(form.get('supplyNotes'));
    const imageFiles = form.getAll('images').filter((f): f is File => f instanceof File);
    const imageFileSlots = safeParseIds(form.get('imageFileSlots'));
    const existingImages = safeParseImageMappings(form.get('existingImages'));

    if (!workId || Number.isNaN(workId)) {
      return NextResponse.json({ message: 'work_id가 필요합니다.' }, { status: 400 });
    }

    const targetWork = await fetchWorkRowById(workId);
    if (!targetWork) {
      return NextResponse.json({ message: '해당 업무를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!targetWork.checklistSetId) {
      return NextResponse.json({ message: '체크리스트 세트가 없습니다.' }, { status: 400 });
    }

    const [checklistRows, supplyChecklistRows, imageSlotRows] = await Promise.all([
      db
        .select({
          id: workChecklistSetDetail.id,
          type: workChecklistList.type,
          setScore: workChecklistSetDetail.score,
          listScore: workChecklistList.score
        })
        .from(workChecklistSetDetail)
        .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
        .where(and(eq(workChecklistSetDetail.checklistHeaderId, targetWork.checklistSetId), eq(workChecklistList.type, 2)))
        .orderBy(
          asc(sql`COALESCE(${workChecklistSetDetail.ordering}, ${workChecklistList.ordering})`),
          asc(workChecklistSetDetail.id)
        ),
      db
        .select({ id: workChecklistList.id })
        .from(workChecklistList)
        .where(eq(workChecklistList.type, 3))
        .orderBy(asc(sql`COALESCE(${workChecklistList.ordering}, ${workChecklistList.id})`)),
      targetWork.imagesSetId
        ? db
            .select({
              id: workImagesSetDetail.id,
              required: workImagesSetDetail.required,
              listRequired: workImagesList.required
            })
            .from(workImagesSetDetail)
            .innerJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
            .where(and(eq(workImagesSetDetail.imagesSetId, targetWork.imagesSetId), eq(workImagesList.role, 2)))
            .orderBy(
              asc(sql`COALESCE(${workImagesSetDetail.ordering}, ${workImagesList.ordering})`),
              asc(workImagesSetDetail.id)
            )
        : Promise.resolve([])
    ]);

    const supervisingChecklistIds = checklistRows.filter((row) => row.type === 2).map((row) => row.id);

    const requiredImageIds = imageSlotRows
      .filter((row) => row.required ?? row.listRequired)
      .map((row) => row.id);

    if (imageFiles.length !== imageFileSlots.length) {
      return NextResponse.json({ message: '이미지 매핑 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const uploads: { slotId: number; url: string }[] = [];
    if (imageFiles.length) {
      try {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'work', String(workId), 'supervising');
        const urlPrefix = path.posix.join('/uploads/work', String(workId), 'supervising');
        uploads.push(
          ...await processImageUploads({ files: imageFiles, slots: imageFileSlots, baseDir: uploadDir, urlPrefix })
        );
      } catch (error) {
        if (error instanceof UploadError) {
          const status = error.code === 'FILE_TOO_LARGE' || error.code === 'TOTAL_TOO_LARGE' ? 413 : 400;
          const message = mapUploadErrorMessage(error.code);
          return NextResponse.json({ message }, { status });
        }
        throw error;
      }
    }

    const imageMap = new Map<number, string>();
    existingImages.forEach((img) => {
      if (!Number.isFinite(img.slotId) || !img.url) return;
      imageMap.set(Number(img.slotId), img.url);
    });
    uploads.forEach((img) => {
      if (!Number.isFinite(img.slotId) || !img.url) return;
      imageMap.set(Number(img.slotId), img.url);
    });

    const readinessMessages: string[] = [];

    const incompleteIds = supervisingChecklistIds.filter((id) => !supervisingCompletion[id]);
    if (incompleteIds.length) {
      readinessMessages.push('완료여부를 모두 체크해주세요.');
    }

    if (requiredImageIds.some((id) => !imageMap.has(id))) {
      readinessMessages.push('필수 사진 항목을 확인하세요.');
    }

    if (!isDraft && readinessMessages.length) {
      return NextResponse.json({ message: readinessMessages.join(' / ') }, { status: 400 });
    }

    const rowsToInsert = [] as {
      workId: number;
      type: number;
      contents1: unknown;
      contents2?: unknown | null;
    }[];

    const validSupplyChecks = supplyChecks.filter((id) => supplyChecklistRows.some((row) => row.id === id));

    rowsToInsert.push({
      workId,
      type: 4,
      contents1: supervisingFindings,
      contents2: supervisingComment ?? null
    });

    if (validSupplyChecks.length || hasSupplyNotes(supplyNotes)) {
      rowsToInsert.push({
        workId,
        type: 2,
        contents1: validSupplyChecks,
        contents2: hasSupplyNotes(supplyNotes) ? supplyNotes : null
      });
    }

    if (imageMap.size) {
      const images = Array.from(imageMap.entries()).map(([slotId, url]) => ({ slotId, url }));
      // NOTE:
      //  - contents1: canonical slotId→url 매핑
      //  - contents2: legacy 호환을 위해 동일한 값을 중복 저장(과거 클라이언트가 contents2를 참조)
      rowsToInsert.push({ workId, type: 5, contents1: images, contents2: images });
    }

    const targetTypes = [4, 2, 5];
    await db.transaction(async (tx) => {
      await tx.delete(workReports).where(and(eq(workReports.workId, workId), inArray(workReports.type, targetTypes)));

      if (rowsToInsert.length) {
        await tx.insert(workReports).values(rowsToInsert);
      }

      if (!isDraft) {
        const nowKst = getKstNow();
        const nowTime = nowKst.toTimeString().slice(0, 8);

        await tx
          .update(workHeader)
          .set({ supervisingYn: true, supervisingEndTime: nowTime })
          .where(eq(workHeader.id, workId));

        const findingIds = supervisingChecklistIds.filter((id) => supervisingFindings[id]);
        const scoredIds = [...new Set(findingIds)];
        const scoreMap = new Map<number, number>(
          checklistRows.map((row) => [row.id, Number(row.setScore ?? row.listScore) || 0])
        );
        const checklistPointSum = scoredIds.reduce((sum, id) => sum + (scoreMap.get(id) ?? 0), 0);

        if (targetWork.cleanerId) {
          const evaluationPayload = {
            workerId: targetWork.cleanerId,
            evaluatedAt: new Date(),
            workId,
            checklistTitleArray: scoredIds,
            checklistPointSum,
            comment: '수퍼바이징 결과'
          };

          const existingHistory = await tx
            .select({ id: workerEvaluateHistory.id })
            .from(workerEvaluateHistory)
            .where(eq(workerEvaluateHistory.workId, workId))
            .limit(1);

          if (existingHistory.length) {
            await tx.update(workerEvaluateHistory).set(evaluationPayload).where(eq(workerEvaluateHistory.workId, workId));
          } else {
            await tx.insert(workerEvaluateHistory).values(evaluationPayload);
          }
        }
      }
    });

    return NextResponse.json({ ok: true, images: rowsToInsert.find((row) => row.type === 5)?.contents1 ?? [] });
  } catch (error) {
    await logServerError({ appName: 'supervising-reports', message: '수퍼바이징 완료보고 저장 실패', error });
    return NextResponse.json({ message: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function safeParseIds(value: FormDataEntryValue | null): number[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => Number(v)).filter((v) => !Number.isNaN(v));
    }
    return [];
  } catch {
    return [];
  }
}

function safeParseChecklistFlags(value: FormDataEntryValue | null): Record<number, boolean> {
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);

    if (typeof parsed === 'boolean') return {};
    if (Array.isArray(parsed)) {
      const set = new Set<number>();
      parsed.forEach((entry) => {
        const num = Number(entry);
        if (Number.isFinite(num)) set.add(num);
      });
      return Array.from(set.values()).reduce((acc, id) => ({ ...acc, [id]: true }), {} as Record<number, boolean>);
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).reduce((acc, [key, val]) => {
        const numKey = Number.parseInt(key, 10);
        if (!Number.isFinite(numKey)) return acc;
        acc[numKey] = Boolean(val);
        return acc;
      }, {} as Record<number, boolean>);
    }

    return {};
  } catch {
    return {};
  }
}

function safeParseComment(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return trimmed.slice(0, 15);
}

function safeParseImageMappings(value: FormDataEntryValue | null): { slotId: number; url: string }[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        slotId: Number(item?.slotId),
        url: typeof item?.url === 'string' ? item.url : ''
      }))
      .filter((item) => Number.isFinite(item.slotId) && item.url);
  } catch {
    return [];
  }
}

function safeParseSupplyNotes(value: FormDataEntryValue | null): Record<number, string> {
  if (!value || typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.entries(parsed as Record<string, unknown>).reduce((acc, [key, val]) => {
      const note = typeof val === 'string' ? val.trim() : '';
      const numericKey = Number.parseInt(key, 10);
      if (note && Number.isFinite(numericKey)) {
        acc[numericKey] = note;
      }
      return acc;
    }, {} as Record<number, string>);
  } catch {
    return {};
  }
}

function hasSupplyNotes(notes: Record<number, string>) {
  return Object.values(notes).some((val) => Boolean(val?.trim()));
}

function mapUploadErrorMessage(code: UploadError['code']) {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return '이미지 용량이 너무 큽니다. 5MB 이하로 업로드해 주세요.';
    case 'TOTAL_TOO_LARGE':
      return '이미지 총 용량이 너무 큽니다. 용량을 줄여 다시 시도해 주세요.';
    case 'INVALID_SLOT':
      return '이미지 매핑 정보가 올바르지 않습니다.';
    default:
      return '이미지 업로드 중 오류가 발생했습니다.';
  }
}
