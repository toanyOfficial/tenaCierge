import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { and, asc, eq, gte, or } from 'drizzle-orm';

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

const tierLabelMap: Record<number, string> = {
  1: '블랙',
  2: '대기',
  3: '보류',
  4: '비기너',
  5: '숙련자',
  6: '전문가',
  7: '버틀러',
  99: '관리자'
};

type CleanerTimeSegment = 'preBatch' | 'batching' | 'applyWindow';

export type CleanerApplication = {
  id: number;
  date: string;
  dateLabel: string;
  sectorLabel: string;
};

export type CleanerSnapshot = {
  tier: number | null;
  tierLabel: string;
  applyAvailableAt: string;
  canApplyNow: boolean;
  workApplied: boolean;
  tomorrowWorkApplied: boolean;
  sectorName: string | null;
  tomorrowSectorName: string | null;
  message: string;
  workDateLabel: string;
  currentTimeLabel: string;
  timeSegment: CleanerTimeSegment;
  assignmentSummary: string | null;
  applications: CleanerApplication[];
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
  primaryRole: string | null;
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
  const phone = cookieStore.get('phone')?.value || cookieStore.get('tc_phone')?.value || '-';
  const registerNo = cookieStore.get('register_no')?.value || cookieStore.get('tc_register')?.value || '-';
  const name = cookieStore.get('name')?.value || cookieStore.get('tc_name')?.value || '이름 미지정';
  const roles = parseRoles(cookieStore.get('role_arrange')?.value ?? cookieStore.get('tc_roles')?.value);
  const primaryRoleCookie = cookieStore.get('role')?.value?.trim();

  return {
    phone,
    registerNo,
    name,
    roles,
    primaryRole: primaryRoleCookie && roles.includes(primaryRoleCookie) ? primaryRoleCookie : roles[0] ?? null
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
    const targetDateStr = formatDateKey(nowKst);
    const tomorrow = new Date(nowKst);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateStr = formatDateKey(tomorrow);

    const assignmentsRaw = await db
      .select({
        id: workHeader.id,
        date: workHeader.date,
        sectorLabel: etcBuildings.sectorLabel,
        buildingName: etcBuildings.buildingName,
        roomNo: clientRooms.roomNo
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.room, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(and(eq(workHeader.cleanerId, worker.id), gte(workHeader.date, targetDateStr)))
      .orderBy(asc(workHeader.date))
      .limit(6);

    const assignments = assignmentsRaw.map((entry) => ({
      ...entry,
      date: normalizeDateValue(entry.date)
    }));

    const todayAssignment = assignments.find((entry) => entry.date === targetDateStr);
    const tomorrowAssignment = assignments.find((entry) => entry.date === tomorrowDateStr);

    const applyAvailableAt = getApplyStartLabel(worker.tier);
    const nowMinutes = getMinutesFromDate(nowKst);
    const timeSegment = resolveTimeSegment(nowMinutes);
    const canApplyNow = timeSegment === 'applyWindow' && nowMinutes >= parseTimeToMinutes(applyAvailableAt);
    const workApplied = Boolean(todayAssignment);
    const tomorrowWorkApplied = Boolean(tomorrowAssignment);
    const sectorName = todayAssignment?.sectorLabel ?? todayAssignment?.buildingName ?? worker.sectorName ?? null;
    const tomorrowSectorName = tomorrowAssignment?.sectorLabel ?? tomorrowAssignment?.buildingName ?? worker.sectorName ?? null;
    const tierLabel = getTierLabel(worker.tier);
    const assignmentSummary = todayAssignment?.buildingName
      ? `${todayAssignment.buildingName}${todayAssignment.roomNo ? ` · ${todayAssignment.roomNo}` : ''}`
      : null;
    const applications: CleanerApplication[] = assignments.map((assignmentEntry) => ({
      id: assignmentEntry.id,
      date: assignmentEntry.date,
      dateLabel: formatApplicationDateLabel(assignmentEntry.date),
      sectorLabel: assignmentEntry.sectorLabel ?? assignmentEntry.buildingName ?? worker.sectorName ?? '미정'
    }));

    const message = buildCleanerMessage({
      segment: timeSegment,
      workAppliedToday: workApplied,
      tomorrowWorkApplied,
      canApplyNow,
      name: profile.name,
      tierLabel,
      applyAvailableAt,
      sectorName,
      tomorrowSectorName
    });

    return {
      tier: worker.tier,
      tierLabel,
      applyAvailableAt,
      canApplyNow,
      workApplied,
      tomorrowWorkApplied,
      sectorName,
      tomorrowSectorName,
      message,
      workDateLabel: formatDateLabel(nowKst),
      currentTimeLabel: formatTimeLabel(nowKst),
      timeSegment,
      assignmentSummary,
      applications
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
  workAppliedToday: boolean;
  tomorrowWorkApplied: boolean;
  canApplyNow: boolean;
  name: string;
  tierLabel: string;
  applyAvailableAt: string;
  sectorName: string | null;
  tomorrowSectorName: string | null;
};

function buildCleanerMessage({
  segment,
  workAppliedToday,
  tomorrowWorkApplied,
  canApplyNow,
  name,
  tierLabel,
  applyAvailableAt,
  sectorName,
  tomorrowSectorName
}: CleanerMessageOptions) {
  const tierText = tierLabel || '-';
  const sector = sectorName ?? '지정 구역';
  const tomorrowSector = tomorrowSectorName ?? '지정 구역';

  if (segment === 'preBatch') {
    if (workAppliedToday) {
      return `${name}님은 오늘 ${sector} 근무를 신청해주셨습니다. 11:30까지 출근 부탁드립니다.`;
    }

    return `${name} 님은 현재 '${tierText}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
  }

  if (segment === 'batching') {
    return `내일 과업지시서가 생성중입니다. ${name} 님은 현재 '${tierText}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
  }

  if (tomorrowWorkApplied) {
    return `${name}님은 내일 ${tomorrowSector} 근무를 신청해주셨습니다. 11:30까지 출근 부탁드립니다.`;
  }

  if (workAppliedToday) {
    return `${name}님은 오늘 ${sector} 근무를 신청해주셨습니다. 11:30까지 출근 부탁드립니다.`;
  }

  if (canApplyNow) {
    return `${name} 님, 지금 업무 신청이 가능합니다. 화면 ID 003에서 희망 근무를 선택해 주세요.`;
  }

  return `${name} 님은 현재 '${tierText}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
}

function formatDateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

function formatApplicationDateLabel(dateString: string) {
  const date = new Date(`${dateString}T00:00:00+09:00`);

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
}

function getTierLabel(tier: number | null) {
  if (typeof tier === 'number' && tierLabelMap[tier]) {
    return tierLabelMap[tier];
  }

  return '미정';
}

function normalizeDateValue(value: string | Date) {
  if (value instanceof Date) {
    return formatDateKey(value);
  }

  return value;
}
