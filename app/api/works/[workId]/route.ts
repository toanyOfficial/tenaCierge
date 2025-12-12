import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { logServerError } from '@/src/server/errorLogger';
import { fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { validateWorkInput, type WorkMutationValues } from '@/src/server/workValidation';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { resolveWorkWindow } from '@/src/utils/workWindow';
import { withUpdateAuditFields } from '@/src/server/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: { workId: string } }) {
  let workId: number | null = null;

  try {
    workId = Number(params.workId);

    if (!Number.isFinite(workId)) {
      return NextResponse.json({ message: '잘못된 작업 ID 입니다.' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) ?? {};
    const profile = await getProfileWithDynamicRoles();
    const isAdmin = profile.roles.includes('admin');
    const isHost = profile.roles.includes('host');

    if (!isAdmin && !isHost) {
      return NextResponse.json({ message: '수정 권한이 없습니다.' }, { status: 403 });
    }

    const workRow = await fetchWorkRowById(workId);

    if (!workRow) {
      return NextResponse.json({ message: '대상을 찾을 수 없습니다.' }, { status: 404 });
    }

    const current = serializeWorkRow(workRow);

    if (!isAdmin) {
      const client = await findClientByProfile(profile);

      if (!client || current.clientId !== client.id) {
        return NextResponse.json({ message: '해당 객실을 수정할 수 없습니다.' }, { status: 403 });
      }

      const meta = resolveWorkWindow(undefined, current.date);

      if (!meta.hostCanEdit) {
        return NextResponse.json({ message: '지금은 수정할 수 있는 시간이 아닙니다.' }, { status: 403 });
      }
    }

    const validation = validateWorkInput(body, current, { canEditRequirements: isAdmin });

    if (!validation.ok) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const updatePayload = buildUpdatePayload(validation.values);

    if (updatePayload) {
      updatePayload.manualUptYn = true;
    }

    if (!updatePayload) {
      return NextResponse.json({ message: '변경할 값이 없습니다.' }, { status: 400 });
    }

    const auditedPayload = withUpdateAuditFields(updatePayload, profile.registerNo);

    await db.update(workHeader).set(auditedPayload).where(eq(workHeader.id, workId));

    const refreshed = await fetchWorkRowById(workId);
    const nextState: CleaningWork | null = refreshed ? serializeWorkRow(refreshed) : null;

    return NextResponse.json({ work: nextState ?? current });
  } catch (error) {
    await logServerError({ appName: 'work-update', message: '작업 수정 실패', error, context: { workId } });
    return NextResponse.json({ message: '작업 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function buildUpdatePayload(values: WorkMutationValues) {
  const payload: Record<string, unknown> = {};

  if ('checkoutTime' in values) {
    payload.checkoutTime = values.checkoutTime;
  }

  if ('checkinTime' in values) {
    payload.checkinTime = values.checkinTime;
  }

  if ('blanketQty' in values) {
    payload.blanketQty = values.blanketQty;
  }

  if ('amenitiesQty' in values) {
    payload.amenitiesQty = values.amenitiesQty;
  }

  if ('cancelYn' in values) {
    payload.cancelYn = values.cancelYn;
  }

  if ('cleaningYn' in values) {
    payload.cleaningYn = values.cleaningYn;
  }

  if ('conditionCheckYn' in values) {
    payload.conditionCheckYn = values.conditionCheckYn;
  }

  if ('requirements' in values) {
    payload.requirements = values.requirements;
  }

  return Object.keys(payload).length ? payload : null;
}
