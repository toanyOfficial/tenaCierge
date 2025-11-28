import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workHeader } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { fetchWorkRowById, serializeWorkRow } from '@/src/server/workQueries';
import type { CleaningWork } from '@/src/server/workTypes';
import { validateWorkInput, type WorkMutationValues } from '@/src/server/workValidation';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { resolveWorkWindow } from '@/src/utils/workWindow';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: { workId: string } }) {
  const workId = Number(params.workId);

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

    const meta = resolveWorkWindow();

    if (!meta.hostCanEdit || current.date !== meta.targetDate) {
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

  await db.update(workHeader).set(updatePayload).where(eq(workHeader.id, workId));

  const refreshed = await fetchWorkRowById(workId);
  const nextState: CleaningWork | null = refreshed ? serializeWorkRow(refreshed) : null;

  return NextResponse.json({ work: nextState ?? current });
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

  if ('requirements' in values) {
    payload.requirements = values.requirements;
  }

  return Object.keys(payload).length ? payload : null;
}
