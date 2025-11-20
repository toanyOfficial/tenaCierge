import type { ProfileSummary } from '@/src/utils/profile';
import { getApplyHorizonDays, getApplyStartLabel, getTierLabel } from '@/src/utils/tier';
import { parseTimeString } from '@/src/utils/time';
import { formatDateKey, getKstNow } from '@/src/utils/workWindow';
import { findWorkerByProfile } from '@/src/server/workers';
import { listApplyRows, type ApplyRow } from '@/src/server/workApply';

const INFO_TEXT = `최근 20일간의 업무평가 점수를 합산, 매일 16:30 랭크가 재조정됩니다.\n\n★중요\n신청했다가 취소할 경우 감점됩니다. 신중하게 신청해주세요. ((7-남은날짜) X 2)점 감점)\n\n[ 랭크 구분 ]\nButler : 상위 5%\n전문가 : 상위 10%\n숙련자 : 상위 30%\n\n[ 랭크별 부가권한 ]\n◆ Butler\n- 13,000원의 시급이 책정됩니다.\n- 버틀러 업무에 지원 할 수 있습니다.(버틀러 시급 14,000원)\n- D+7 동안의 업무에 우선지원 할 수 있습니다.\n- 매일 15:00부터 업무 신청 가능합니다.\n\n◆ 전문가\n- 12,000원의 시급이 책정됩니다.\n- D+5 동안의 업무에 우선지원 할 수 있습니다.\n- 매일 15:00부터 업무 신청 가능합니다.\n\n◆ 숙련자\n- 11,000원의 시급이 책정됩니다.\n- D+3 동안의 업무에 우선지원 할 수 있습니다.\n- 매일 16:00부터 업무 신청 가능합니다.\n\n◆ 그 외\n- 10,100원의 시급이 책정됩니다.\n- D+1 업무에 지원 할 수 있습니다.\n- 매일 16:30부터 업무 신청 가능합니다.`;

const ALLOWED_ROLES = ['admin', 'butler', 'cleaner'] as const;
const CUTOFF_MINUTES = 10 * 60;
const FETCH_DAYS = 7;

export type ApplySnapshot = {
  tier: number | null;
  tierLabel: string;
  tierMessage: string;
  applyStartLabel: string;
  horizonDays: number;
  canApplyNow: boolean;
  hasAccess: boolean;
  guardMessage: string | null;
  slots: ApplySlot[];
  workerId: number | null;
  workerTier: number | null;
  isAdmin: boolean;
  infoText: string;
  applyWindowHint: string;
};

export type ApplySlot = {
  id: number;
  workDate: string;
  workDateLabel: string;
  sectorLabel: string;
  positionLabel: string;
  isButlerSlot: boolean;
  assignedWorkerId: number | null;
  assignedWorkerName: string | null;
  daysUntil: number;
  isToday: boolean;
  isMine: boolean;
  isTaken: boolean;
  canApply: boolean;
  canCancel: boolean;
  disabledReason: string | null;
};

export async function getApplySnapshot(profile: ProfileSummary): Promise<ApplySnapshot> {
  const roles = profile.roles;
  const isAdmin = roles.includes('admin');
  const hasButlerRole = roles.includes('butler');
  const hasCleanerRole = roles.includes('cleaner') || hasButlerRole;
  const hasAccess = roles.some((role) => ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number]));
  const now = getKstNow();
  const todayKey = formatDateKey(now);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + FETCH_DAYS);
  const endKey = formatDateKey(endDate);
  const worker = await findWorkerByProfile(profile);
  const workerId = worker?.id ?? null;
  const workerTier = worker?.tier ?? (isAdmin ? 99 : null);
  const tierLabel = getTierLabel(workerTier);
  const tierMessage = `${profile.name}님은 현재 ${tierLabel} 단계입니다.`;
  const rawApplyLabel = getApplyStartLabel(workerTier);
  const displayApplyLabel = isAdmin ? '상시 신청 가능' : rawApplyLabel;
  const applyStartMinutes = isAdmin ? 0 : parseTimeString(rawApplyLabel) ?? 0;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const canApplyNow = isAdmin || nowMinutes >= applyStartMinutes;
  const horizonDays = isAdmin ? FETCH_DAYS : getApplyHorizonDays(workerTier);
  const applyWindowHint = isAdmin
    ? '관리자는 시간·날짜 제한 없이 신청/배정이 가능합니다.'
    : `최대 D+${horizonDays}까지, ${rawApplyLabel}부터 신청 가능합니다.`;
  const guardMessage = hasAccess ? null : '화면 003은 Admin, Butler, Cleaner 역할에게만 제공됩니다. 역할을 전환해 주세요.';
  const rows = await listApplyRows(todayKey, endKey);
  const slots = rows
    .map((row) => buildSlot(row, {
      hasButlerRole,
      hasCleanerRole,
      hasAccess,
      isAdmin,
      workerId,
      baseDate: now,
      nowMinutes,
      canApplyNow,
      horizonDays,
      applyLabel: rawApplyLabel
    }))
    .filter((slot): slot is ApplySlot => Boolean(slot));

  return {
    tier: workerTier,
    tierLabel,
    tierMessage,
    applyStartLabel: displayApplyLabel,
    horizonDays,
    canApplyNow,
    hasAccess,
    guardMessage,
    slots,
    workerId,
    workerTier,
    isAdmin,
    infoText: INFO_TEXT,
    applyWindowHint
  };
}

type SlotBuildContext = {
  hasButlerRole: boolean;
  hasCleanerRole: boolean;
  hasAccess: boolean;
  isAdmin: boolean;
  workerId: number | null;
  baseDate: Date;
  nowMinutes: number;
  canApplyNow: boolean;
  horizonDays: number;
  applyLabel: string;
};

function buildSlot(row: ApplyRow, context: SlotBuildContext) {
  const dateString = normalizeDate(row.workDate);
  const targetDate = parseDate(dateString);
  if (!targetDate) {
    return null;
  }

  const baseDate = new Date(context.baseDate);
  baseDate.setHours(0, 0, 0, 0);
  const diffMs = targetDate.getTime() - baseDate.getTime();
  const daysUntil = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (daysUntil < 0) {
    return null;
  }

  if (daysUntil === 0 && context.nowMinutes >= CUTOFF_MINUTES && !context.isAdmin) {
    return null;
  }

  if (!context.isAdmin && daysUntil > context.horizonDays) {
    return null;
  }

  const isButlerSlot = row.position === 2;
  const occupantId = row.workerId;
  const occupantName = row.workerName;
  const isMine = Boolean(occupantId) && context.workerId === occupantId;
  const roleAllowed = context.isAdmin
    ? true
    : isButlerSlot
      ? context.hasButlerRole
      : context.hasCleanerRole;
  const available = !occupantId;
  const disabledReason = computeDisabledReason({
    roleAllowed,
    withinWindow: context.isAdmin || daysUntil <= context.horizonDays,
    timeOpen: context.canApplyNow,
    available,
    applyLabel: context.applyLabel
  });

  const canApply =
    context.hasAccess &&
    roleAllowed &&
    available &&
    (context.isAdmin || (context.canApplyNow && daysUntil <= context.horizonDays));
  const sectorLabel = row.sectorValue || row.sectorCode || '미지정 섹터';
  const positionLabel = isButlerSlot ? '버틀러' : '클리너';

  return {
    id: row.id,
    workDate: dateString,
    workDateLabel: formatKoreanDate(targetDate),
    sectorLabel,
    
    positionLabel,
    isButlerSlot,
    assignedWorkerId: occupantId ?? null,
    assignedWorkerName: occupantName ?? null,
    daysUntil,
    isToday: daysUntil === 0,
    isMine,
    isTaken: Boolean(occupantId),
    canApply,
    canCancel: context.isAdmin || isMine,
    disabledReason
  } satisfies ApplySlot;
}

function computeDisabledReason({
  roleAllowed,
  withinWindow,
  timeOpen,
  available,
  applyLabel
}: {
  roleAllowed: boolean;
  withinWindow: boolean;
  timeOpen: boolean;
  available: boolean;
  applyLabel: string;
}) {
  if (!roleAllowed) {
    return '해당 역할만 신청할 수 있습니다.';
  }

  if (!withinWindow) {
    return '아직 신청할 수 없는 날짜입니다.';
  }

  if (!timeOpen) {
    return `${applyLabel}부터 신청 가능합니다.`;
  }

  if (!available) {
    return '이미 다른 분이 신청했습니다.';
  }

  return null;
}

function formatKoreanDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
}

function normalizeDate(value: string | Date | null) {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return formatDateKey(value);
  }

  return value.includes('T') ? value.split('T')[0] : value;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00+09:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}
