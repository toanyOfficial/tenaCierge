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
  workReports
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

  if (!profile.roles.some((role) => role === 'admin' || role === 'butler' || role === 'cleaner')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const workId = Number(form.get('workId'));
    const cleaningChecks = safeParseIds(form.get('cleaningChecks'));
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
        type: workChecklistList.type
      })
      .from(workChecklistSetDetail)
      .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
      .where(and(eq(workChecklistSetDetail.checklistHeaderId, targetWork.checklistSetId), eq(workChecklistList.type, 1)))
      .orderBy(
        asc(sql`COALESCE(${workChecklistSetDetail.order}, ${workChecklistList.order})`),
        asc(workChecklistSetDetail.id)
      ),
    db
      .select({ id: workChecklistSetDetail.id, type: workChecklistList.type })
      .from(workChecklistSetDetail)
      .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
      .where(and(eq(workChecklistSetDetail.checklistHeaderId, targetWork.checklistSetId), eq(workChecklistList.type, 3)))
      .orderBy(
        asc(sql`COALESCE(${workChecklistSetDetail.order}, ${workChecklistList.order})`),
        asc(workChecklistSetDetail.id)
      ),
    targetWork.imagesSetId
      ? db
          .select({
            id: workImagesSetDetail.id,
            required: workImagesSetDetail.required,
            listRequired: workImagesList.required
          })
          .from(workImagesSetDetail)
          .leftJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
          .where(and(eq(workImagesSetDetail.imagesSetId, targetWork.imagesSetId), eq(workImagesList.role, 1)))
          .orderBy(
            asc(sql`COALESCE(${workImagesSetDetail.order}, ${workImagesList.order})`),
            asc(workImagesSetDetail.id)
          )
      : Promise.resolve([])
  ]);

    const cleaningChecklistIds = checklistRows.filter((row) => row.type === 1).map((row) => row.id);
    const readinessMessages: string[] = [];

    if (cleaningChecklistIds.length && cleaningChecklistIds.some((id) => !cleaningChecks.includes(id))) {
      readinessMessages.push('체크리스트를 확인하세요');
    }

    if (imageFiles.length !== imageFileSlots.length) {
      return NextResponse.json({ message: '이미지 매핑 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const requiredImageIds = imageSlotRows
      .map((row) => ({ id: row.id, required: row.required ?? row.listRequired }))
      .filter((row) => row.required)
      .map((row) => row.id);

    const uploads: { slotId: number; url: string }[] = [];
    if (imageFiles.length) {
      try {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'work', String(workId));
        const urlPrefix = path.posix.join('/uploads/work', String(workId));
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

    if (requiredImageIds.some((id) => !imageMap.has(id))) {
      readinessMessages.push('필수 사진 항목을 확인하세요.');
    }

    if (readinessMessages.length) {
      return NextResponse.json({ message: readinessMessages.join(' / ') }, { status: 400 });
    }

    const rowsToInsert = [] as {
      workId: number;
      type: number;
      contents1: unknown;
      contents2?: unknown | null;
    }[];

    const cleaningOnly = cleaningChecks.filter((id) => checklistRows.some((row) => row.id === id && row.type === 1));
    const supplyOnly = supplyChecks.filter((id) => supplyChecklistRows.some((row) => row.id === id));
    if (cleaningOnly.length) {
      rowsToInsert.push({ workId, type: 1, contents1: cleaningOnly });
    }

    if (supplyOnly.length || hasSupplyNotes(supplyNotes)) {
      rowsToInsert.push({ workId, type: 2, contents1: supplyOnly, contents2: hasSupplyNotes(supplyNotes) ? supplyNotes : null });
    }

    if (imageMap.size) {
      const images = Array.from(imageMap.entries()).map(([slotId, url]) => ({ slotId, url }));
      // NOTE:
      //  - contents1: canonical slotId→url 매핑
      //  - contents2: legacy 호환을 위해 동일한 값을 중복 저장(과거 클라이언트가 contents2를 참조)
      rowsToInsert.push({ workId, type: 3, contents1: images, contents2: images });
    }

    const targetTypes = [1, 2, 3];
    const nowKst = getKstNow();
    const nowTime = nowKst.toTimeString().slice(0, 8);

    await db.delete(workReports).where(and(eq(workReports.workId, workId), inArray(workReports.type, targetTypes)));

    if (rowsToInsert.length) {
      await db.insert(workReports).values(rowsToInsert);
    }

    await db
      .update(workHeader)
      .set({ cleaningFlag: 4, cleaningEndTime: nowTime })
      .where(eq(workHeader.id, workId));

    await upsertCleaningWorkReport(workId, { field: 'contents2', key: 'end_dttm' });

    return NextResponse.json({ ok: true, images: rowsToInsert.find((row) => row.type === 3)?.contents1 ?? [] });
  } catch (error) {
    await logServerError({ appName: 'work-reports', message: '청소완료보고 저장 실패', error });
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

async function upsertCleaningWorkReport(
  workId: number,
  options: { field: 'contents1' | 'contents2'; key: 'start_dttm' | 'end_dttm' }
) {
  const now = getKstNow().toISOString();

  const existing = await db
    .select({ id: workReports.id, contents1: workReports.contents1, contents2: workReports.contents2 })
    .from(workReports)
    .where(and(eq(workReports.workId, workId), eq(workReports.type, 6)))
    .limit(1);

  const target = existing[0];

  if (!target) {
    const payload: { workId: number; type: number; contents1: unknown; contents2?: unknown | null } = {
      workId,
      type: 6,
      contents1: options.field === 'contents1' ? { [options.key]: now } : {},
      contents2: options.field === 'contents2' ? { [options.key]: now } : null
    };

    await db.insert(workReports).values(payload);
    return;
  }

  const contents1 = normalizeRecord(target.contents1);
  const contents2 = normalizeRecord(target.contents2);

  const updates: Record<string, unknown> = {};

  if (options.field === 'contents1') {
    updates.contents1 = { ...contents1, [options.key]: now };
  }

  if (options.field === 'contents2') {
    updates.contents2 = { ...contents2, [options.key]: now };
  }

  if (Object.keys(updates).length) {
    await db.update(workReports).set(updates).where(eq(workReports.id, target.id));
  }
}

function normalizeRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
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
