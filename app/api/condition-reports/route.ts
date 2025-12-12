import path from 'path';

import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import { workHeader, workImagesList, workImagesSetDetail, workReports } from '@/src/db/schema';
import { withInsertAuditFields, withUpdateAuditFields } from '@/src/server/audit';
import { KST } from '@/src/lib/time';
import { logServerError } from '@/src/server/errorLogger';
import { processImageUploads, UploadError } from '@/src/server/imageUpload';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { fetchWorkRowById } from '@/src/server/workQueries';
import { getKstNow } from '@/src/utils/workWindow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.some((role) => role === 'admin' || role === 'butler' || role === 'cleaner')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  let logContext: Record<string, unknown> = {};
  try {
    const form = await req.formData();
    const workId = Number(form.get('workId'));
    const imageFiles = form.getAll('images').filter((file): file is File => file instanceof File);
    const imageFileSlots = safeParseIds(form.get('imageFileSlots'));
    const existingImages = safeParseImageMappings(form.get('existingImages'));

    logContext = {
      workId,
      imageFileCount: imageFiles.length,
      imageFileSlotCount: imageFileSlots.length,
      existingImageCount: existingImages.length
    };

    if (!workId || Number.isNaN(workId)) {
      return NextResponse.json({ message: 'work_id가 필요합니다.' }, { status: 400 });
    }

    const targetWork = await fetchWorkRowById(workId);
    if (!targetWork) {
      return NextResponse.json({ message: '해당 업무를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!targetWork.conditionCheckYn) {
      return NextResponse.json({ message: '상태확인 대상 업무가 아닙니다.' }, { status: 400 });
    }

    if (!targetWork.imagesSetId) {
      return NextResponse.json({ message: '사진 세트 정보가 없습니다.' }, { status: 400 });
    }

    const slotRows = await db
      .select({
        id: workImagesSetDetail.id,
        title: workImagesSetDetail.title,
        listTitle: workImagesList.title,
        comment: workImagesSetDetail.comment,
        listComment: workImagesList.comment,
        required: workImagesSetDetail.required,
        listRequired: workImagesList.required
      })
      .from(workImagesSetDetail)
      .innerJoin(workImagesList, eq(workImagesSetDetail.imagesListId, workImagesList.id))
      .where(and(eq(workImagesSetDetail.imagesSetId, targetWork.imagesSetId), eq(workImagesList.role, 3)))
      .orderBy(asc(workImagesSetDetail.id));

    if (!slotRows.length) {
      return NextResponse.json({ message: '상태확인 사진 항목을 찾을 수 없습니다.' }, { status: 400 });
    }

    if (imageFiles.length !== imageFileSlots.length) {
      return NextResponse.json({ message: '이미지 매핑 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const uploads: { slotId: number; url: string }[] = [];
    if (imageFiles.length) {
      try {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'work', String(workId), 'condition');
        const urlPrefix = path.posix.join('/uploads/work', String(workId), 'condition');
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

    const requiredIds = slotRows
      .map((row) => ({ id: row.id, required: row.required ?? row.listRequired }))
      .filter((row) => row.required)
      .map((row) => row.id);

    if (requiredIds.some((id) => !imageMap.has(id))) {
      return NextResponse.json({ message: '필수 사진 항목을 확인하세요.' }, { status: 400 });
    }

    const images = Array.from(imageMap.entries()).map(([slotId, url]) => ({ slotId, url }));

    await db.delete(workReports).where(and(eq(workReports.workId, workId), eq(workReports.type, 7)));
    if (images.length) {
      await db
        .insert(workReports)
        .values(withInsertAuditFields({ workId, type: 7, contents1: images }, profile.registerNo));
    }

    const nowKst = getKstNow();
    const nowTime = nowKst.toLocaleTimeString('ko-KR', {
      timeZone: KST,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    await db
      .update(workHeader)
      .set(withUpdateAuditFields({ supervisingYn: true, supervisingEndTime: nowTime }, profile.registerNo))
      .where(eq(workHeader.id, workId));

    return NextResponse.json({ ok: true, images, supervisingEndTime: nowTime });
  } catch (error) {
    await logServerError({
      appName: 'condition-reports',
      error,
      message: '상태확인 사진 저장 실패',
      context: logContext
    });
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
