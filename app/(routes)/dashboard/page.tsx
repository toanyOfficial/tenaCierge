import type { Metadata } from 'next';
import { and, asc, desc, eq, gte, or } from 'drizzle-orm';

import DashboardClient from './DashboardClient';

import { clientRooms, etcBuildings, etcNotice, workHeader, workerHeader } from '@/src/db/schema';
import { getProfileSummary, type ProfileSummary } from '@/src/utils/profile';
import { getApplyStartLabel, getTierLabel } from '@/src/utils/tier';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: '모든 역할에 공통으로 노출되는 프로필 및 제어 영역'
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;
const butlerSectorOrder = ['신논현', '역삼', '논현'];

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

export type ButlerCheckoutGroup = {
  checkoutTimeLabel: string;
  count: number;
};

export type ButlerBuildingSummary = {
  buildingName: string;
  totalWorkers: number;
  checkoutGroups: ButlerCheckoutGroup[];
};

export type ButlerSectorSummary = {
  sectorLabel: string;
  totalWorkers: number;
  buildings: ButlerBuildingSummary[];
};

export type ButlerDetailEntry = {
  id: number;
  sectorLabel: string;
  buildingName: string;
  checkoutTimeLabel: string;
  roomNo: string;
};

export type ButlerSnapshot = {
  targetDateLabel: string;
  isToday: boolean;
  sectorSummaries: ButlerSectorSummary[];
  details: ButlerDetailEntry[];
  totalWorks: number;
};

export type AdminNotice = {
  id: number | null;
  text: string;
  dateLabel: string | null;
  updatedAtLabel: string | null;
};

export default async function DashboardPage() {
  const profile = getProfileSummary();
  const cleanerPromise = profile.roles.includes('cleaner') ? getCleanerSnapshot(profile) : Promise.resolve(null);
  const butlerPromise = profile.roles.includes('butler') ? getButlerSnapshot() : Promise.resolve(null);
  const adminNoticePromise = profile.roles.includes('admin') ? getLatestNotice() : Promise.resolve(null);

  const [cleanerSnapshot, butlerSnapshot, adminNotice] = await Promise.all([
    cleanerPromise,
    butlerPromise,
    adminNoticePromise
  ]);

  return (
    <DashboardClient
      profile={profile}
      cleanerSnapshot={cleanerSnapshot}
      butlerSnapshot={butlerSnapshot}
      adminNotice={adminNotice}
    />
  );
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

async function getButlerSnapshot(): Promise<ButlerSnapshot | null> {
  try {
    const { db } = await import('@/src/db/client');
    const nowKst = getKstNow();
    const isTodayWindow = nowKst.getHours() < 15;
    const targetDate = new Date(nowKst);

    if (!isTodayWindow) {
      targetDate.setDate(targetDate.getDate() + 1);
    }

    const targetDateKey = formatDateKey(targetDate);

    const works = await db
      .select({
        id: workHeader.id,
        checkoutTime: workHeader.checkoutTime,
        buildingName: etcBuildings.buildingName,
        sectorLabel: etcBuildings.sectorLabel,
        roomNo: clientRooms.roomNo
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.room, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(eq(workHeader.date, targetDateKey));

    const normalizedWorks = works.map((work) => {
      const sectorLabel = work.sectorLabel ?? '미지정 섹터';
      const buildingName = work.buildingName ?? '미지정 빌딩';
      const checkoutTimeLabel = formatCheckoutTimeLabel(work.checkoutTime);
      const checkoutMinutes = checkoutTimeToMinutes(work.checkoutTime);

      return {
        id: work.id,
        sectorLabel,
        buildingName,
        checkoutTimeLabel,
        checkoutMinutes,
        roomNo: work.roomNo ?? '-'
      };
    });

    const sectorGroups = new Map<
      string,
      {
        label: string;
        totalWorkers: number;
        buildings: Map<
          string,
          {
            label: string;
            totalWorkers: number;
            checkoutGroups: Map<number, { label: string; count: number }>;
          }
        >;
      }
    >();

    const buildingTotals = new Map<string, number>();

    normalizedWorks.forEach((work) => {
      const sectorKey = work.sectorLabel;
      if (!sectorGroups.has(sectorKey)) {
        sectorGroups.set(sectorKey, {
          label: work.sectorLabel,
          totalWorkers: 0,
          buildings: new Map()
        });
      }

      const sectorGroup = sectorGroups.get(sectorKey)!;
      sectorGroup.totalWorkers += 1;

      const buildingKey = `${work.sectorLabel}::${work.buildingName}`;
      buildingTotals.set(buildingKey, (buildingTotals.get(buildingKey) ?? 0) + 1);

      if (!sectorGroup.buildings.has(work.buildingName)) {
        sectorGroup.buildings.set(work.buildingName, {
          label: work.buildingName,
          totalWorkers: 0,
          checkoutGroups: new Map()
        });
      }

      const buildingGroup = sectorGroup.buildings.get(work.buildingName)!;
      buildingGroup.totalWorkers += 1;

      const minutesKey = work.checkoutMinutes;
      const existingGroup = buildingGroup.checkoutGroups.get(minutesKey);
      if (existingGroup) {
        existingGroup.count += 1;
      } else {
        buildingGroup.checkoutGroups.set(minutesKey, { label: work.checkoutTimeLabel, count: 1 });
      }
    });

    const sectorSummaries: ButlerSectorSummary[] = Array.from(sectorGroups.values())
      .sort((a, b) => compareSectorLabel(a.label, b.label))
      .map((sector) => ({
        sectorLabel: sector.label,
        totalWorkers: sector.totalWorkers,
        buildings: Array.from(sector.buildings.values())
          .sort((a, b) => {
            if (a.totalWorkers === b.totalWorkers) {
              return a.label.localeCompare(b.label, 'ko');
            }
            return b.totalWorkers - a.totalWorkers;
          })
          .map((building) => ({
            buildingName: building.label,
            totalWorkers: building.totalWorkers,
            checkoutGroups: Array.from(building.checkoutGroups.entries())
              .sort(([minutesA], [minutesB]) => minutesA - minutesB)
              .map(([, meta]) => ({
                checkoutTimeLabel: meta.label,
                count: meta.count
              }))
          }))
      }));

    const sortedWorks = [...normalizedWorks].sort((a, b) => {
      const sectorDiff = compareSectorLabel(a.sectorLabel, b.sectorLabel);
      if (sectorDiff !== 0) {
        return sectorDiff;
      }

      const buildingKeyA = `${a.sectorLabel}::${a.buildingName}`;
      const buildingKeyB = `${b.sectorLabel}::${b.buildingName}`;
      const buildingTotalA = buildingTotals.get(buildingKeyA) ?? 0;
      const buildingTotalB = buildingTotals.get(buildingKeyB) ?? 0;
      if (buildingTotalA !== buildingTotalB) {
        return buildingTotalB - buildingTotalA;
      }

      if (a.checkoutMinutes !== b.checkoutMinutes) {
        return a.checkoutMinutes - b.checkoutMinutes;
      }

      return b.roomNo.localeCompare(a.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
    });

    const details: ButlerDetailEntry[] = sortedWorks.map((work) => ({
      id: work.id,
      sectorLabel: work.sectorLabel,
      buildingName: work.buildingName,
      checkoutTimeLabel: work.checkoutTimeLabel,
      roomNo: work.roomNo
    }));

    return {
      targetDateLabel: formatDateLabel(targetDate),
      isToday: isTodayWindow,
      sectorSummaries,
      details,
      totalWorks: normalizedWorks.length
    };
  } catch (error) {
    console.error('버틀러 현황 조회 실패', error);
    return null;
  }
}

async function getLatestNotice(): Promise<AdminNotice | null> {
  try {
    const { db } = await import('@/src/db/client');
    const [latest] = await db
      .select({
        id: etcNotice.id,
        notice: etcNotice.notice,
        noticeDate: etcNotice.noticeDate,
        updatedAt: etcNotice.updatedAt
      })
      .from(etcNotice)
      .orderBy(desc(etcNotice.updatedAt))
      .limit(1);

    if (!latest) {
      return null;
    }

    const noticeDate = parseDateValue(latest.noticeDate);
    const updatedAt = parseDateValue(latest.updatedAt);

    return {
      id: latest.id,
      text: latest.notice ?? '',
      dateLabel: noticeDate ? formatDateLabel(noticeDate) : null,
      updatedAtLabel: updatedAt ? formatTimestampLabel(updatedAt) : null
    };
  } catch (error) {
    console.error('공지 조회 실패', error);
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

function formatTimestampLabel(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
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

function normalizeDateValue(value: string | Date) {
  if (value instanceof Date) {
    return formatDateKey(value);
  }

  return value;
}

function parseDateValue(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const normalized = value.includes('T') ? value : `${value}T00:00:00+09:00`;
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatCheckoutTimeLabel(value: string | Date | null | undefined) {
  if (!value) {
    return '--:--';
  }

  if (value instanceof Date) {
    const hours = `${value.getHours()}`.padStart(2, '0');
    const minutes = `${value.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const parts = value.split(':');
  const hour = (parts[0] ?? '00').padStart(2, '0');
  const minute = (parts[1] ?? '00').padStart(2, '0');
  return `${hour}:${minute}`;
}

function checkoutTimeToMinutes(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }

  if (typeof value === 'string' && value.length) {
    const parts = value.split(':');
    const hour = Number(parts[0] ?? '0');
    const minute = Number(parts[1] ?? '0');

    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      return hour * 60 + minute;
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function compareSectorLabel(a: string, b: string) {
  const indexA = butlerSectorOrder.indexOf(a);
  const indexB = butlerSectorOrder.indexOf(b);

  if (indexA !== -1 && indexB !== -1) {
    return indexA - indexB;
  }

  if (indexA !== -1) {
    return -1;
  }

  if (indexB !== -1) {
    return 1;
  }

  return a.localeCompare(b, 'ko');
}
