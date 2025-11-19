import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { and, eq, or } from 'drizzle-orm';

import DashboardClient from './DashboardClient';

import { clientRooms, etcBuildings, workHeader, workerHeader } from '@/src/db/schema';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: '모든 역할에 공통으로 노출되는 프로필 및 제어 영역'
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;
const tierApplyWindows: Record<number, string> = {
  99: '15:00',
  7: '15:00',
  6: '15:10',
  5: '15:20',
  4: '15:30',
  3: '15:40',
  2: '15:50',
  1: '16:00'
};
const DEFAULT_APPLY_TIME = '16:00';

type CleanerTimeSegment = 'preBatch' | 'batching' | 'applyWindow';

export type CleanerSnapshot = {
  tier: number | null;
  applyAvailableAt: string;
  canApplyNow: boolean;
  workApplied: boolean;
  sectorName: string | null;
  message: string;
  workDateLabel: string;
  currentTimeLabel: string;
  timeSegment: CleanerTimeSegment;
  assignmentSummary: string | null;
};

function normalizeRoleList(list: string[]) {
  const unique = Array.from(new Set(list.map((role) => role.toLowerCase())));

  return unique
    .filter((role) => roleOrder.includes(role as (typeof roleOrder)[number]))
    .sort((a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number]));
}

export type ProfileSummary = {
  phone: string;
  registerNo: string;
  name: string;
  roles: string[];
};

function parseRoles(raw: string | undefined | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return normalizeRoleList(parsed.map((role) => String(role)));
    }
  } catch (error) {
    // fall through to string parsing below
  }

  return normalizeRoleList(
    raw
      .split(',')
      .map((role) => role.trim())
  );
}

function getProfileSummary(): ProfileSummary {
  const cookieStore = cookies();
  const phone = cookieStore.get('tc_phone')?.value || '-';
  const registerNo = cookieStore.get('tc_register')?.value || '-';
  const name = cookieStore.get('tc_name')?.value || '이름 미지정';
  const roles = parseRoles(cookieStore.get('tc_roles')?.value);

  return {
    phone,
    registerNo,
    name,
    roles
  };
}

export default async function DashboardPage() {
  const profile = getProfileSummary();
  const cleanerSnapshot = profile.roles.includes('cleaner') ? await getCleanerSnapshot(profile) : null;

  return <DashboardClient profile={profile} cleanerSnapshot={cleanerSnapshot} />;
}

async function getCleanerSnapshot(profile: ProfileSummary): Promise<CleanerSnapshot | null> {
  const phone = sanitize(profile.phone);
  const registerNo = sanitize(profile.registerNo);

  if (!phone && !registerNo) {
    return null;
  }

  const whereClause = buildWorkerWhereClause(phone, registerNo);

  if (!whereClause) {
    return null;
  }

  try {
    const { db } = await import('@/src/db/client');

    const [worker] = await db
      .select({
        id: workerHeader.id,
        tier: workerHeader.tier,
        sectorName: workerHeader.bankValue
      })
      .from(workerHeader)
      .where(whereClause)
      .limit(1);

    if (!worker) {
      return null;
    }

    const nowKst = getKstNow();
    const targetDateStr = nowKst.toISOString().split('T')[0];

    const [assignment] = await db
      .select({
        sectorLabel: etcBuildings.sectorLabel,
        buildingName: etcBuildings.buildingName,
        roomNo: clientRooms.roomNo
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.room, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(and(eq(workHeader.cleanerId, worker.id), eq(workHeader.date, targetDateStr)))
      .limit(1);

    const applyAvailableAt = getApplyStartLabel(worker.tier);
    const nowMinutes = getMinutesFromDate(nowKst);
    const timeSegment = resolveTimeSegment(nowMinutes);
    const canApplyNow = timeSegment === 'applyWindow' && nowMinutes >= parseTimeToMinutes(applyAvailableAt);
    const workApplied = Boolean(assignment);
    const sectorName = assignment?.sectorLabel ?? assignment?.buildingName ?? worker.sectorName ?? null;

    const message = buildCleanerMessage({
      segment: timeSegment,
      workApplied,
      canApplyNow,
      name: profile.name,
      tier: worker.tier,
      applyAvailableAt,
      sectorName
    });

    return {
      tier: worker.tier,
      applyAvailableAt,
      canApplyNow,
      workApplied,
      sectorName,
      message,
      workDateLabel: formatDateLabel(nowKst),
      currentTimeLabel: formatTimeLabel(nowKst),
      timeSegment,
      assignmentSummary: assignment?.buildingName
        ? `${assignment.buildingName}${assignment.roomNo ? ` · ${assignment.roomNo}` : ''}`
        : null
    };
  } catch (error) {
    console.error('클리너 상태 조회 실패', error);
    return null;
  }
}

function buildWorkerWhereClause(phone?: string, registerNo?: string) {
  const conditions = [];

  if (registerNo) {
    conditions.push(eq(workerHeader.registerCode, registerNo));
  }

  if (phone) {
    conditions.push(eq(workerHeader.phone, phone));
  }

  if (conditions.length === 0) {
    return null;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return or(...conditions);
}

function sanitize(value: string | undefined) {
  if (!value || value === '-') {
    return undefined;
  }

  return value;
}

function getKstNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

function getMinutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function resolveTimeSegment(minutes: number): CleanerTimeSegment {
  if (minutes <= 14 * 60) {
    return 'preBatch';
  }

  if (minutes <= 15 * 60) {
    return 'batching';
  }

  return 'applyWindow';
}

function getApplyStartLabel(tier: number | null) {
  if (typeof tier === 'number' && tierApplyWindows[tier]) {
    return tierApplyWindows[tier];
  }

  return DEFAULT_APPLY_TIME;
}

function parseTimeToMinutes(label: string) {
  const [hour = '0', minute = '0'] = label.split(':');
  return Number(hour) * 60 + Number(minute);
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
}

function formatTimeLabel(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

type CleanerMessageOptions = {
  segment: CleanerTimeSegment;
  workApplied: boolean;
  canApplyNow: boolean;
  name: string;
  tier: number | null;
  applyAvailableAt: string;
  sectorName: string | null;
};

function buildCleanerMessage({
  segment,
  workApplied,
  canApplyNow,
  name,
  tier,
  applyAvailableAt,
  sectorName
}: CleanerMessageOptions) {
  const tierLabel = typeof tier === 'number' ? tier : '-';
  const sector = sectorName ?? '지정 구역';

  if (segment === 'preBatch') {
    if (workApplied) {
      return `${name}님은 오늘 ${sector} 근무를 신청해주셨습니다. 11:30까지 출근 부탁드립니다.`;
    }

    return `${name} 님은 현재 '${tierLabel}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
  }

  if (segment === 'batching') {
    return `내일 과업지시서가 생성중입니다. ${name} 님은 현재 '${tierLabel}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
  }

  if (workApplied) {
    return `${name}님은 오늘 ${sector} 근무를 신청해주셨습니다. 11:30까지 출근 부탁드립니다.`;
  }

  if (canApplyNow) {
    return `${name} 님, 지금 업무 신청이 가능합니다. 화면 ID 003에서 희망 근무를 선택해 주세요.`;
  }

  return `${name} 님은 현재 '${tierLabel}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
}
