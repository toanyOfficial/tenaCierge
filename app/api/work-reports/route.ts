import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { NextResponse } from 'next/server';

import { db } from '@/src/db/client';
import { workReports } from '@/src/db/schema';
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

    if (!workId || Number.isNaN(workId)) {
      return NextResponse.json({ message: 'work_id가 필요합니다.' }, { status: 400 });
    }

    const targetWork = await fetchWorkRowById(workId);
    if (!targetWork) {
      return NextResponse.json({ message: '해당 업무를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!cleaningChecks.length && !supplyChecks.length && !imageFiles.length) {
      return NextResponse.json({ message: '체크 또는 사진을 입력해 주세요.' }, { status: 400 });
    }

    const uploads: string[] = [];
    if (imageFiles.length) {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'work', String(workId));
      await mkdir(uploadDir, { recursive: true });

      for (const file of imageFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const safeName = sanitizeFilename(file.name);
        const destName = `${Date.now()}-${safeName}`;
        const destPath = path.join(uploadDir, destName);
        await writeFile(destPath, buffer);
        uploads.push(path.posix.join('/uploads/work', String(workId), destName));
      }
    }

    const rowsToInsert = [] as {
      workId: number;
      type: number;
      contents1: unknown;
      contents2?: unknown | null;
    }[];

    if (cleaningChecks.length) {
      rowsToInsert.push({ workId, type: 1, contents1: cleaningChecks });
    }

    if (supplyChecks.length) {
      rowsToInsert.push({ workId, type: 2, contents1: supplyChecks });
    }

    if (uploads.length) {
      rowsToInsert.push({ workId, type: 3, contents1: uploads, contents2: uploads });
    }

    if (rowsToInsert.length) {
      await db.insert(workReports).values(rowsToInsert);
    }

    return NextResponse.json({ ok: true });
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
