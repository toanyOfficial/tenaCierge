import type { Metadata } from 'next';
import { and, asc, desc, eq, gte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import DashboardClient from './DashboardClient';

import { clientRooms, etcBaseCode, etcBuildings, etcNotice, workApply, workHeader, workerHeader } from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { getApplyStartLabel, getTierLabel } from '@/src/utils/tier';
import { formatKstDateKey, nowKst } from '@/src/lib/time';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: '모든 역할에 공통으로 노출되는 프로필 및 제어 영역'
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;

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
  highlightApply: boolean;
  highlightWorklist: boolean;
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
  workTypeLabel: string;
  isCleaning: boolean;
  comment: string;
};

export type ButlerSnapshot = {
  targetDateKey: string;
  targetDateLabel: string;
  isToday: boolean;
  sectorSummaries: ButlerSectorSummary[];
  details: ButlerDetailEntry[];
  totalWorks: number;
  preferredSectors: string[];
};

export type ButlerSnapshotOption = ButlerSnapshot & { key: string; preferredDefault?: boolean };

export type AdminNotice = {
  id: number | null;
  text: string;
  dateLabel: string | null;
  updatedAtLabel: string | null;
};

export default async function DashboardPage() {
  const profile = await getProfileWithDynamicRoles();
  const cleanerPromise = profile.roles.includes('cleaner') ? getCleanerSnapshot(profile) : Promise.resolve(null);
  const butlerPromise = profile.roles.includes('butler') ? getButlerSnapshots(profile) : Promise.resolve([]);
  const adminNoticePromise = profile.roles.includes('admin') ? getLatestNotice() : Promise.resolve(null);

  const [cleanerSnapshot, butlerSnapshots, adminNotice] = await Promise.all([
    cleanerPromise,
    butlerPromise,
    adminNoticePromise
  ]);

  return (
    <DashboardClient
      profile={profile}
      cleanerSnapshot={cleanerSnapshot}
      butlerSnapshots={butlerSnapshots}
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

    const workerSector = alias(etcBaseCode, 'workerSector');

    const [worker] = await db
      .select({
        id: workerHeader.id,
        tier: workerHeader.tier,
        sectorName: workerSector.value
      })
      .from(workerHeader)
      .leftJoin(workerSector, and(eq(workerSector.codeGroup, workerHeader.bankCode), eq(workerSector.code, workerHeader.bankValue)))
      .where(whereClause)
      .limit(1);

    if (!worker) {
      return null;
    }

    const nowKst = getKstNow();
    const targetDateStr = formatDateKey(nowKst);
    const targetDate = parseDateValue(targetDateStr);
    const tomorrow = new Date(nowKst);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateStr = formatDateKey(tomorrow);

    const buildingSector = alias(etcBaseCode, 'buildingSector');

    const assignmentsRaw = await db
      .select({
        id: workHeader.id,
        date: workHeader.date,
        sectorLabel: buildingSector.value,
        buildingName: etcBuildings.shortName,
        roomNo: clientRooms.roomNo
      })
      .from(workHeader)
      .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
      .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .leftJoin(
        buildingSector,
        and(eq(buildingSector.codeGroup, etcBuildings.sectorCode), eq(buildingSector.code, etcBuildings.sectorValue))
      )
      .where(and(eq(workHeader.cleanerId, worker.id), gte(workHeader.date, targetDate ?? nowKst)))
      .orderBy(asc(workHeader.date))
      .limit(6);

    const assignments = assignmentsRaw.map((entry) => ({
      ...entry,
      date: normalizeDateValue(entry.date)
    }));

    const todayAssignment = assignments.find((entry) => entry.date === targetDateStr);
    const tomorrowAssignment = assignments.find((entry) => entry.date === tomorrowDateStr);

    const applySector = alias(etcBaseCode, 'applySector');

    const applicationsRaw = await db
      .select({
        id: workApply.id,
        date: workApply.workDate,
        sectorLabel: applySector.value
      })
      .from(workApply)
      .leftJoin(applySector, and(eq(applySector.codeGroup, workApply.sectorCode), eq(applySector.code, workApply.sectorValue)))
      .where(and(eq(workApply.workerId, worker.id), gte(workApply.workDate, targetDate ?? nowKst)))
      .orderBy(asc(workApply.workDate), asc(workApply.seq))
      .limit(10);

    const applications = applicationsRaw.map((entry) => ({
      id: entry.id,
      date: normalizeDateValue(entry.date),
      dateLabel: formatApplicationDateLabel(normalizeDateValue(entry.date)),
      sectorLabel: entry.sectorLabel ?? worker.sectorName ?? '미정'
    }));

    const applyAvailableAt = getApplyStartLabel(worker.tier);
    const nowMinutes = getMinutesFromDate(nowKst);
    const timeSegment = resolveTimeSegment(nowMinutes);
    const canApplyNow = timeSegment === 'applyWindow' && nowMinutes >= parseTimeToMinutes(applyAvailableAt);
    const workApplied = Boolean(applications.find((app) => app.date === targetDateStr) ?? todayAssignment);
    const tomorrowWorkApplied = Boolean(applications.find((app) => app.date === tomorrowDateStr) ?? tomorrowAssignment);
    const sectorName =
      applications.find((app) => app.date === targetDateStr)?.sectorLabel ??
      todayAssignment?.sectorLabel ??
      todayAssignment?.buildingName ??
      worker.sectorName ??
      null;
    const tomorrowSectorName =
      applications.find((app) => app.date === tomorrowDateStr)?.sectorLabel ??
      tomorrowAssignment?.sectorLabel ??
      tomorrowAssignment?.buildingName ??
      worker.sectorName ??
      null;
    const tierLabel = getTierLabel(worker.tier);
    const assignmentSummary = todayAssignment?.buildingName
      ? `${todayAssignment.buildingName}${todayAssignment.roomNo ? ` · ${todayAssignment.roomNo}` : ''}`
      : null;
    const highlightWorklist = Boolean(workApplied && nowMinutes < parseTimeToMinutes('16:30'));
    const highlightApply = Boolean(canApplyNow);

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
      applications,
      highlightApply,
      highlightWorklist
    };
  } catch (error) {
    console.error('클리너 상태 조회 실패', error);
    return null;
  }
}

async function getButlerSnapshots(profile: ProfileSummary): Promise<ButlerSnapshotOption[]> {
  try {
    const nowKst = getKstNow();
    const today = new Date(nowKst);
    const tomorrow = new Date(nowKst);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const preferredSectors: string[] = await resolvePreferredSectors(profile);

    const snapshots = await Promise.all([
      buildButlerSnapshot(today, true, preferredSectors),
      buildButlerSnapshot(tomorrow, false, preferredSectors)
    ]);

    const nowMinutes = getMinutesFromDate(nowKst);
    const defaultKey = nowMinutes < 990 ? formatDateKey(today) : formatDateKey(tomorrow);

    return snapshots
      .filter(Boolean)
      .map((snapshot) => ({
        ...snapshot!,
        key: snapshot!.targetDateKey,
        preferredDefault: snapshot!.targetDateKey === defaultKey
      }))
      .sort((a, b) => (a.isToday === b.isToday ? 0 : a.isToday ? -1 : 1));
  } catch (error) {
    console.error('버틀러 현황 조회 실패', error);
    return [];
  }
}

async function buildButlerSnapshot(
  targetDate: Date,
  isToday: boolean,
  preferredSectors: string[]
): Promise<ButlerSnapshot | null> {
  const { db } = await import('@/src/db/client');
  const targetDateKey = formatDateKey(targetDate);
  const targetDateValue = parseDateValue(targetDateKey) ?? targetDate;

  const works = await db
    .select({
      id: workHeader.id,
      checkoutTime: workHeader.checkoutTime,
      buildingName: etcBuildings.shortName,
      sectorLabel: etcBaseCode.value,
      sectorCode: etcBuildings.sectorCode,
      sectorValue: etcBuildings.sectorValue,
      roomNo: clientRooms.roomNo,
      cleaningYn: workHeader.cleaningYn,
      conditionCheckYn: workHeader.conditionCheckYn,
      comment: workHeader.requirements
    })
    .from(workHeader)
    .leftJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
    .leftJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
    .leftJoin(
      etcBaseCode,
      and(eq(etcBaseCode.codeGroup, etcBuildings.sectorCode), eq(etcBaseCode.code, etcBuildings.sectorValue))
    )
    .where(
      and(eq(workHeader.date, targetDateValue), eq(workHeader.cleaningYn, true), eq(workHeader.cancelYn, false))
    );

  const normalizedWorks = works.map((work) => {
    const sectorLabel = work.sectorLabel ?? work.sectorValue ?? work.sectorCode ?? '미지정 섹터';
    const sectorCode = normalizeSectorCode(work.sectorCode);
    const buildingName = work.buildingName ?? '미지정 빌딩';
    const checkoutTimeLabel = formatCheckoutTimeLabel(work.checkoutTime);
    const checkoutMinutes = checkoutTimeToMinutes(work.checkoutTime);
    const isCleaning = Boolean(work.cleaningYn);
    const workTypeLabel = isCleaning ? '청소' : '점검';

    return {
      id: work.id,
      sectorLabel,
      sectorCode,
      buildingName,
      checkoutTimeLabel,
      checkoutMinutes,
      roomNo: work.roomNo ?? '-',
      workTypeLabel,
      isCleaning,
      comment: work.comment ?? ''
    };
  });

  const buildingTotals = new Map<string, number>();
  normalizedWorks.forEach((work) => {
    const buildingKey = `${work.sectorCode ?? work.sectorLabel}::${work.buildingName}`;
    buildingTotals.set(buildingKey, (buildingTotals.get(buildingKey) ?? 0) + 1);
  });

  const buildingOrder = new Map<string, Map<string, number>>();
  const sectorKeys = new Set<string>();
  normalizedWorks.forEach((work) => {
    sectorKeys.add(`${work.sectorCode ?? work.sectorLabel}`);
  });

  sectorKeys.forEach((sectorKey) => {
    const buildingsInSector = Array.from(buildingTotals.entries())
      .filter(([key]) => key.startsWith(`${sectorKey}::`))
      .map(([key, count]) => ({
        buildingName: key.split('::')[1] ?? '',
        total: count
      }))
      .sort((a, b) => {
        if (a.total === b.total) {
          return a.buildingName.localeCompare(b.buildingName, 'ko');
        }
        return b.total - a.total;
      });

    const rankMap = new Map<string, number>();
    buildingsInSector.forEach((building, index) => {
      rankMap.set(building.buildingName, index);
    });
    buildingOrder.set(sectorKey, rankMap);
  });

  const cleaningWorks = normalizedWorks;

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

  cleaningWorks.forEach((work) => {
    const sectorKey = work.sectorCode ?? work.sectorLabel;
    if (!sectorGroups.has(sectorKey)) {
      sectorGroups.set(sectorKey, {
        label: work.sectorLabel,
        sectorCode: work.sectorCode,
        totalWorkers: 0,
        buildings: new Map()
      });
    }

    const sectorGroup = sectorGroups.get(sectorKey)!;
    sectorGroup.totalWorkers += 1;

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
    .sort((a, b) => compareSectorByCode(a.sectorCode ?? null, b.sectorCode ?? null, a.label, b.label))
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
    const sectorDiff = compareSectorByCode(
      a.sectorCode ?? null,
      b.sectorCode ?? null,
      a.sectorLabel,
      b.sectorLabel
    );
    if (sectorDiff !== 0) {
      return sectorDiff;
    }

    const sectorKey = `${a.sectorCode ?? a.sectorLabel}`;
    const buildingRank = buildingOrder.get(sectorKey);
    const buildingRankA = buildingRank?.get(a.buildingName) ?? Number.MAX_SAFE_INTEGER;
    const buildingRankB = buildingRank?.get(b.buildingName) ?? Number.MAX_SAFE_INTEGER;
    if (buildingRankA !== buildingRankB) {
      return buildingRankA - buildingRankB;
    }

    return b.roomNo.localeCompare(a.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
  });

  const details: ButlerDetailEntry[] = sortedWorks.map((work) => ({
    id: work.id,
    sectorLabel: work.sectorLabel,
    buildingName: work.buildingName,
    checkoutTimeLabel: work.checkoutTimeLabel,
    roomNo: work.roomNo,
    workTypeLabel: work.workTypeLabel,
    isCleaning: work.workTypeLabel === '청소',
    comment: work.comment
  }));

  return {
    targetDateKey: targetDateKey,
    targetDateLabel: formatDateLabel(targetDate),
    isToday,
    sectorSummaries,
    details,
    totalWorks: normalizedWorks.length,
    preferredSectors
  };
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
  return nowKst().toJSDate();
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
    weekday: 'short',
    timeZone: 'Asia/Seoul'
  }).format(date);
}

function formatTimeLabel(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul'
  }).format(date);
}

function formatTimestampLabel(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul'
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
    return `${name} 님, 지금 업무 신청이 가능합니다. 업무신청 화면에서 희망 근무를 선택해 주세요.`;
  }

  return `${name} 님은 현재 '${tierText}' 단계의 클리너이십니다. ${applyAvailableAt}부터 업무 신청이 가능합니다.`;
}

function formatDateKey(date: Date) {
  return formatKstDateKey(date);
}

function formatApplicationDateLabel(dateString: string) {
  const date = new Date(`${dateString}T00:00:00+09:00`);

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Seoul'
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

async function resolvePreferredSectors(profile: ProfileSummary): Promise<string[]> {
  const phone = sanitize(profile.phone);
  const registerNo = sanitize(profile.registerNo);

  if (!phone && !registerNo) {
    return [];
  }

  const whereClause = buildWorkerWhereClause(phone, registerNo);

  if (!whereClause) {
    return [];
  }

  try {
    const { db } = await import('@/src/db/client');
    const workerSector = alias(etcBaseCode, 'preferredSector');
    const [worker] = await db
      .select({ id: workerHeader.id, sectorName: workerSector.value })
      .from(workerHeader)
      .leftJoin(
        workerSector,
        and(eq(workerSector.codeGroup, workerHeader.bankCode), eq(workerSector.code, workerHeader.bankValue))
      )
      .where(whereClause)
      .limit(1);

    if (!worker) {
      return [];
    }

    const nowKst = getKstNow();
    const targetDate = new Date(nowKst);
    const todayKey = formatDateKey(targetDate);
    const todayDateValue = parseDateValue(todayKey) ?? targetDate;
    const tomorrow = new Date(nowKst);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = formatDateKey(tomorrow);

    const applySector = alias(etcBaseCode, 'applySector');

    const applyRows = await db
      .select({
        sectorLabel: applySector.value,
        workDate: workApply.workDate
      })
      .from(workApply)
      .leftJoin(applySector, and(eq(applySector.codeGroup, workApply.sectorCode), eq(applySector.code, workApply.sectorValue)))
      .where(and(eq(workApply.workerId, worker.id), gte(workApply.workDate, todayDateValue)))
      .orderBy(asc(workApply.workDate))
      .limit(6);

    const sectors = applyRows
      .filter((row) => {
        const normalized = normalizeDateValue(row.workDate);
        return normalized === todayKey || normalized === tomorrowKey;
      })
      .map((row) => row.sectorLabel)
      .filter(Boolean) as string[];

    if (worker.sectorName) {
      sectors.unshift(worker.sectorName);
    }

    return Array.from(new Set(sectors));
  } catch (error) {
    console.error('버틀러 선호 섹터 계산 실패', error);
    return [];
  }
}

function compareSectorByCode(
  aCode: number | null,
  bCode: number | null,
  aLabel: string,
  bLabel: string
) {
  if (aCode !== null && bCode !== null && aCode !== bCode) {
    return aCode - bCode;
  }

  if (aCode !== null && bCode === null) {
    return -1;
  }

  if (aCode === null && bCode !== null) {
    return 1;
  }

  return aLabel.localeCompare(bLabel, 'ko');
}

function normalizeSectorCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}
