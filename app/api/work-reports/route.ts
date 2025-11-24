import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import {
  workChecklistList,
  workChecklistSetDetail,
  workHeader,
  workImagesList,
  workImagesSetDetail,
  workImagesSetHeader,
  workReports
} from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById } from '@/src/server/workQueries';

export const runtime = 'nodejs';

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

  const [checklistRows, imageSlotRows] = await Promise.all([
    db
      .select({
        id: workChecklistSetDetail.id,
        type: workChecklistList.type
      })
      .from(workChecklistSetDetail)
      .leftJoin(workChecklistList, eq(workChecklistSetDetail.checklistListId, workChecklistList.id))
      .where(and(eq(workChecklistSetDetail.checklistHeaderId, targetWork.checklistSetId), inArray(workChecklistList.type, [1, 3])))
      .orderBy(asc(workChecklistList.type), asc(workChecklistSetDetail.seq), asc(workChecklistSetDetail.id)),
      targetWork.imagesSetId
        ? db
            .select({
              id: workImagesSetDetail.id,
              required: workImagesSetDetail.required
            })
            .from(workImagesSetDetail)
            .leftJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
            .leftJoin(workImagesSetHeader, eq(workImagesSetDetail.imagesSetId, workImagesSetHeader.id))
            .where(and(eq(workImagesSetDetail.imagesSetId, targetWork.imagesSetId), eq(workImagesSetHeader.role, 1)))
            .orderBy(asc(workImagesSetDetail.seq), asc(workImagesSetDetail.id))
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

    const requiredImageIds = imageSlotRows.filter((row) => row.required).map((row) => row.id);

    const uploads: { slotId: number; url: string }[] = [];
    if (imageFiles.length) {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'work', String(workId));
      await mkdir(uploadDir, { recursive: true });

      for (const [index, file] of imageFiles.entries()) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const safeName = sanitizeFilename(file.name);
        const destName = `${Date.now()}-${safeName}`;
        const destPath = path.join(uploadDir, destName);
        await writeFile(destPath, buffer);
        uploads.push({ slotId: imageFileSlots[index], url: path.posix.join('/uploads/work', String(workId), destName) });
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
    const supplyOnly = supplyChecks.filter((id) => checklistRows.some((row) => row.id === id && row.type === 3));
    if (cleaningOnly.length) {
      rowsToInsert.push({ workId, type: 1, contents1: cleaningOnly });
    }

    if (supplyOnly.length) {
      rowsToInsert.push({ workId, type: 2, contents1: supplyOnly });
    }

    if (imageMap.size) {
      const images = Array.from(imageMap.entries()).map(([slotId, url]) => ({ slotId, url }));
      rowsToInsert.push({ workId, type: 3, contents1: images, contents2: images });
    }

    const targetTypes = [1, 2, 3];

    await db.delete(workReports).where(and(eq(workReports.workId, workId), inArray(workReports.type, targetTypes)));

    if (rowsToInsert.length) {
      await db.insert(workReports).values(rowsToInsert);
    }

    await db.update(workHeader).set({ cleaningFlag: 4 }).where(eq(workHeader.id, workId));

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

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
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
