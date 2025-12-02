import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workHeader, workReports, workerHeader } from '@/src/db/schema';
import { logServerError } from '@/src/server/errorLogger';
import { findWorkerByProfile } from '@/src/server/workers';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { getKstNow } from '@/src/utils/workWindow';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: { workId: string } }) {
  const workId = Number(params.workId);
  if (!Number.isFinite(workId)) {
    return NextResponse.json({ message: '유효한 작업 ID가 아닙니다.' }, { status: 400 });
  }

  try {

    const body = (await request.json().catch(() => null)) ?? {};
    const profile = await getProfileWithDynamicRoles();
    const isAdmin = profile.roles.includes('admin');
    const isButler = profile.roles.includes('butler');
    const isCleaner = profile.roles.includes('cleaner');

    const workRows = await db
      .select({
        id: workHeader.id,
        roomId: workHeader.roomId,
        cleanerId: workHeader.cleanerId,
        butlerId: workHeader.butlerId,
        supplyYn: workHeader.supplyYn,
        cleaningFlag: workHeader.cleaningFlag,
        supervisingYn: workHeader.supervisingYn,
        supervisingEndTime: workHeader.supervisingEndTime
      })
      .from(workHeader)
      .where(eq(workHeader.id, workId))
      .limit(1);

    const current = workRows[0];

    if (!current) {
      return NextResponse.json({ message: '대상을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (body.noShow === true) {
      if (!isAdmin && !isButler) {
        return NextResponse.json({ message: '노쇼 처리 권한이 없습니다.' }, { status: 403 });
      }

      const previousReports = await db
        .select({
          workId: workReports.workId,
          type: workReports.type,
          contents1: workReports.contents1,
          contents2: workReports.contents2,
          createdAt: workReports.createdAt
        })
        .from(workReports)
        .innerJoin(workHeader, eq(workReports.workId, workHeader.id))
        .where(eq(workHeader.roomId, current.roomId))
        .orderBy(desc(workReports.createdAt))
        .limit(50);

      const latestByType = new Map<number, { contents1: unknown; contents2: unknown | null }>();
      previousReports.forEach((report) => {
        if (report.workId === workId) return;
        if (!latestByType.has(report.type)) {
          latestByType.set(report.type, {
            contents1: report.contents1,
            contents2: report.contents2 ?? report.contents1
          });
        }
      });

      const nowTime = getKstNow().toTimeString().slice(0, 8);
      await db.transaction(async (tx) => {
        await tx
          .delete(workReports)
          .where(and(eq(workReports.workId, workId), inArray(workReports.type, [3, 5])));

        const rowsToInsert: { workId: number; type: number; contents1: unknown; contents2?: unknown | null }[] = [];
        [3, 5].forEach((type) => {
          const payload = latestByType.get(type);
          if (payload) {
            rowsToInsert.push({
              workId,
              type,
              contents1: payload.contents1,
              contents2: payload.contents2
            });
          }
        });

        if (rowsToInsert.length) {
          await tx.insert(workReports).values(rowsToInsert);
        }

        await tx
          .update(workHeader)
          .set({
            cleanerId: null,
            butlerId: null,
            manualUptYn: true,
            cleaningFlag: 4,
            cleaningEndTime: nowTime,
            supervisingYn: true,
            supervisingEndTime: nowTime
          })
          .where(eq(workHeader.id, workId));
      });

      const refreshed = await db
        .select({
          id: workHeader.id,
          supplyYn: workHeader.supplyYn,
          cleaningFlag: workHeader.cleaningFlag,
          supervisingYn: workHeader.supervisingYn,
          supervisingEndTime: workHeader.supervisingEndTime,
          cleanerId: workHeader.cleanerId,
          cleanerName: workerHeader.name
        })
        .from(workHeader)
        .leftJoin(workerHeader, eq(workHeader.cleanerId, workerHeader.id))
        .where(eq(workHeader.id, workId))
        .limit(1);

      const next = refreshed[0];

      return NextResponse.json({
        work: {
          supplyYn: Boolean(next?.supplyYn),
          cleaningFlag: Number(next?.cleaningFlag ?? 4),
          supervisingYn: Boolean(next?.supervisingYn ?? true),
          supervisingEndTime: next?.supervisingEndTime ?? null,
          cleanerId: next?.cleanerId ?? null,
          cleanerName: next?.cleanerName ?? ''
        }
      });
    }

    if (!isAdmin && !isButler) {
      if (body.cleaningFlag && !isCleaner) {
        return NextResponse.json({ message: '변경 권한이 없습니다.' }, { status: 403 });
      }

      if (isCleaner) {
        const me = await findWorkerByProfile(profile);
        if (!me || current.cleanerId !== me.id) {
          return NextResponse.json({ message: '배정된 작업만 업데이트할 수 있습니다.' }, { status: 403 });
        }
      }
    }

    const updates: Record<string, unknown> = {};

    if (typeof body.supplyYn === 'boolean') {
      if (!isAdmin && !isButler) {
        return NextResponse.json({ message: '배급 상태는 관리자/버틀러만 변경할 수 있습니다.' }, { status: 403 });
      }
      updates.supplyYn = body.supplyYn;
    }

    if (typeof body.cleaningFlag === 'number') {
      if (!isAdmin && !isButler && !isCleaner) {
        return NextResponse.json({ message: '청소 상태 변경 권한이 없습니다.' }, { status: 403 });
      }
      const nextFlag = clamp(body.cleaningFlag, 1, 4);
      updates.cleaningFlag = nextFlag;
    }

    if (typeof body.supervisingDone === 'boolean') {
      if (!isAdmin && !isButler) {
        return NextResponse.json({ message: '검수 상태는 관리자/버틀러만 변경할 수 있습니다.' }, { status: 403 });
      }
      updates.supervisingYn = body.supervisingDone;
      updates.supervisingEndTime = body.supervisingDone ? getKstNow() : null;
    }

    if (typeof body.assignTerm === 'string' && (isAdmin || isButler)) {
      const term = body.assignTerm.trim();
      const normalized = term.replace(/\D/g, '');
      const searchTerm = normalized || term.toUpperCase();
      const rows = await db
        .select({ id: workerHeader.id })
        .from(workerHeader)
        .where(
          or(
            eq(workerHeader.registerCode, searchTerm),
            eq(workerHeader.phone, normalized ? normalized.slice(0, 11) : searchTerm)
          )
        )
        .limit(1);

      if (!rows[0]) {
        return NextResponse.json({ message: '해당 직원 정보를 찾을 수 없습니다.' }, { status: 404 });
      }

      updates.cleanerId = rows[0].id;
    }

  if (Object.prototype.hasOwnProperty.call(body, 'cleanerId') && (isAdmin || isButler)) {
    const cleanerId = body.cleanerId;
    if (cleanerId === null) {
      updates.cleanerId = null;
    } else if (typeof cleanerId === 'number' && Number.isFinite(cleanerId)) {
      const rows = await db
        .select({ id: workerHeader.id })
        .from(workerHeader)
        .where(eq(workerHeader.id, cleanerId))
        .limit(1);
      if (!rows[0]) {
        return NextResponse.json({ message: '해당 직원 정보를 찾을 수 없습니다.' }, { status: 404 });
      }
      updates.cleanerId = cleanerId;
    }
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ message: '변경할 항목이 없습니다.' }, { status: 400 });
  }

  updates.manualUptYn = true;

  await db.update(workHeader).set(updates).where(eq(workHeader.id, workId));

  const refreshed = await db
    .select({
      id: workHeader.id,
      supplyYn: workHeader.supplyYn,
      cleaningFlag: workHeader.cleaningFlag,
      supervisingYn: workHeader.supervisingYn,
      supervisingEndTime: workHeader.supervisingEndTime,
      cleanerId: workHeader.cleanerId,
      cleanerName: workerHeader.name
    })
    .from(workHeader)
    .leftJoin(workerHeader, eq(workHeader.cleanerId, workerHeader.id))
    .where(eq(workHeader.id, workId))
    .limit(1);

  const next = refreshed[0];

  return NextResponse.json({
    work: {
      supplyYn: Boolean(next?.supplyYn),
      cleaningFlag: Number(next?.cleaningFlag ?? updates.cleaningFlag ?? 1),
      supervisingYn: Boolean(next?.supervisingYn ?? updates.supervisingYn ?? false),
      supervisingEndTime: next?.supervisingEndTime ?? null,
      cleanerId: next?.cleanerId ?? null,
      cleanerName: next?.cleanerName ?? ''
    }
  });
  } catch (error) {
    await logServerError({ appName: 'workflow', message: '워크플로우 업데이트 실패', error, context: { workId } });
    return NextResponse.json({ message: '작업 흐름 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
