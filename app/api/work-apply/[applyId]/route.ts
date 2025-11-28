import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workApply, workerEvaluateHistory } from '@/src/db/schema';
import { getApplyRowById } from '@/src/server/workApply';
import { findWorkerById, findWorkerByProfile } from '@/src/server/workers';
import { getApplyHorizonDays, getApplyStartLabel } from '@/src/utils/tier';
import { parseTimeString } from '@/src/utils/time';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { getKstNow } from '@/src/utils/workWindow';
import type { ProfileSummary } from '@/src/utils/profile';
import { getActivePenalty } from '@/src/server/penalties';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLES = ['admin', 'butler', 'cleaner'] as const;
const CUTOFF_MINUTES = 10 * 60;
const PENALTY_COMMENT = '업무 신청 취소 패널티';

type Body = {
  action: 'apply' | 'cancel';
  workerId?: number;
};

export async function PATCH(request: Request, { params }: { params: { applyId: string } }) {
  const applyId = Number(params.applyId);

  if (!Number.isFinite(applyId) || applyId <= 0) {
    return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
  }

  const profile = await getProfileWithDynamicRoles();
  const hasAccess = profile.roles.some((role) => ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number]));

  if (!hasAccess) {
    return NextResponse.json({ message: '신청 권한이 없습니다.' }, { status: 403 });
  }

  const body = (await request.json()) as Body;

  if (body.action !== 'apply' && body.action !== 'cancel') {
    return NextResponse.json({ message: '지원하지 않는 동작입니다.' }, { status: 400 });
  }

  const slot = await getApplyRowById(applyId);

  if (!slot) {
    return NextResponse.json({ message: '해당 업무를 찾을 수 없습니다.' }, { status: 404 });
  }

  const now = getKstNow();
  const daysUntil = computeDaysUntil(slot.workDate, now);
  const isButlerSlot = slot.position === 2;
  const occupantId = slot.workerId && slot.workerId > 0 ? slot.workerId : null;

  if (body.action === 'apply') {
    return handleApply({ profile, slot, now, daysUntil, isButlerSlot, occupantId, body });
  }

  return handleCancel({ profile, slot, now, daysUntil, isButlerSlot, occupantId });
}

type ApplyContext = {
  profile: ProfileSummary;
  slot: NonNullable<Awaited<ReturnType<typeof getApplyRowById>>>;
  now: Date;
  daysUntil: number;
  isButlerSlot: boolean;
  occupantId: number | null;
  body: Body;
};

async function handleApply({ profile, slot, now, daysUntil, isButlerSlot, occupantId, body }: ApplyContext) {
  const isAdmin = profile.roles.includes('admin');
  const worker = isAdmin
    ? await resolveAdminWorker(body.workerId)
    : await findWorkerByProfile(profile);

  if (!worker) {
    return NextResponse.json({ message: '신청 가능한 작업자 정보를 찾을 수 없습니다.' }, { status: 400 });
  }

  if (!isAdmin) {
    const roleAllowed = isButlerSlot ? profile.roles.includes('butler') : profile.roles.includes('cleaner') || profile.roles.includes('butler');

    if (!roleAllowed) {
      return NextResponse.json({ message: '해당 역할에 허용되지 않은 업무입니다.' }, { status: 403 });
    }

    const applyStartLabel = getApplyStartLabel(worker.tier);
    const startMinutes = parseTimeString(applyStartLabel) ?? 0;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const penaltyWindow = await getActivePenalty(worker.id, now);

    if (penaltyWindow.active) {
      const span = `${penaltyWindow.start ?? ''}${penaltyWindow.end ? `~${penaltyWindow.end}` : ''}`;
      return NextResponse.json({ message: `패널티 기간(${span})에는 신청할 수 없습니다.` }, { status: 403 });
    }

    if (daysUntil === 0 && nowMinutes >= CUTOFF_MINUTES) {
      return NextResponse.json({ message: 'D0 업무는 10:00 이후에 신청할 수 없습니다.' }, { status: 400 });
    }

    if (nowMinutes < startMinutes) {
      return NextResponse.json({ message: `${applyStartLabel}부터 신청 가능합니다.` }, { status: 400 });
    }

    const horizonDays = getApplyHorizonDays(worker.tier);

    if (daysUntil > horizonDays) {
      return NextResponse.json({ message: '아직 신청할 수 없는 날짜입니다.' }, { status: 400 });
    }
  }

  if (occupantId && occupantId !== worker.id) {
    return NextResponse.json({ message: '이미 다른 작업자가 신청한 일정입니다.' }, { status: 409 });
  }

  if (occupantId === worker.id) {
    return NextResponse.json({ message: '이미 신청이 완료된 일정입니다.' }, { status: 200 });
  }

  await db.update(workApply).set({ workerId: worker.id }).where(eq(workApply.id, slot.id));

  return NextResponse.json({ message: '신청이 완료되었습니다.' });
}

type CancelContext = {
  profile: ProfileSummary;
  slot: NonNullable<Awaited<ReturnType<typeof getApplyRowById>>>;
  now: Date;
  daysUntil: number;
  isButlerSlot: boolean;
  occupantId: number | null;
};

async function handleCancel({ profile, slot, now, daysUntil, isButlerSlot, occupantId }: CancelContext) {
  const isAdmin = profile.roles.includes('admin');

  if (!occupantId) {
    return NextResponse.json({ message: '아직 누구도 신청하지 않은 일정입니다.' }, { status: 400 });
  }

  if (!isAdmin) {
    const worker = await findWorkerByProfile(profile);

    if (!worker || worker.id !== occupantId) {
      return NextResponse.json({ message: '본인 신청만 취소할 수 있습니다.' }, { status: 403 });
    }
  }

  const penalty = Math.max(0, 7 - Math.max(daysUntil, 0)) * 2;
  const checklist = { '1': `${Math.max(daysUntil, 0)}일전업무취소` };

  await db.transaction(async (tx) => {
    await tx.update(workApply).set({ workerId: null }).where(eq(workApply.id, slot.id));

    await tx.insert(workerEvaluateHistory).values({
      workerId: occupantId,
      evaluatedAt: now,
      workId: slot.id,
      checklistTitleArray: checklist,
      checklistPointSum: penalty,
      comment: PENALTY_COMMENT
    });
  });

  return NextResponse.json({ message: '신청이 취소되었습니다.' });
}

async function resolveAdminWorker(workerId?: number) {
  if (!workerId || workerId <= 0) {
    return null;
  }

  return findWorkerById(workerId);
}

function computeDaysUntil(value: string | Date | null, baseDate: Date) {
  const dateString = normalizeDate(value);

  if (!dateString) {
    return Number.POSITIVE_INFINITY;
  }

  const target = new Date(`${dateString}T00:00:00+09:00`);
  const base = new Date(baseDate);
  base.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - base.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeDate(value: string | Date | null) {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  return value.includes('T') ? value.split('T')[0] : value;
}
