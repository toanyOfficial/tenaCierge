import type { ProfileSummary } from '@/src/utils/profile';
import { getApplyHorizonDays, getApplyStartLabel, getTierLabel } from '@/src/utils/tier';
import { parseTimeString } from '@/src/utils/time';
import { formatDateKey, getKstNow } from '@/src/utils/workWindow';
import { findWorkerByProfile } from '@/src/server/workers';
import { listApplyRows, type ApplyRow } from '@/src/server/workApply';
import { workerTierRules } from '@/src/db/schema';

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
  tierRules: TierRuleDisplay[];
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

export type TierRuleDisplay = {
  tier: number;
  tierLabel: string;
  rangeLabel: string;
  applyStartLabel: string;
  horizonDays: number;
  hourlyWage: number | null;
  comment: string | null;
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
  const tierRules = await fetchTierRules();
  const worker = await findWorkerByProfile(profile);
  const workerId = worker?.id ?? null;
  const workerTier = worker?.tier ?? (isAdmin ? 99 : null);
  const tierLabel = getTierLabel(workerTier);
  const tierMessage = `${profile.name}님은 현재 ${tierLabel} 단계입니다.`;
  const ruleForTier = tierRules.find((rule) => rule.tier === workerTier);
  const rawApplyLabel = ruleForTier?.applyStartLabel ?? getApplyStartLabel(workerTier);
  const displayApplyLabel = isAdmin ? '상시 신청 가능' : rawApplyLabel;
  const applyStartMinutes = isAdmin ? 0 : parseTimeString(rawApplyLabel) ?? 0;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const canApplyNow = isAdmin || nowMinutes >= applyStartMinutes;
  const horizonDays = isAdmin ? FETCH_DAYS : ruleForTier?.horizonDays ?? getApplyHorizonDays(workerTier);
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
    tierRules,
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
  const occupantId = row.workerId && row.workerId > 0 ? row.workerId : null;
  const occupantName = occupantId ? row.workerName : null;
  const isMine = occupantId !== null && context.workerId === occupantId;
  const roleAllowed = context.isAdmin
    ? true
    : isButlerSlot
      ? context.hasButlerRole
      : context.hasCleanerRole;
  const available = occupantId === null;
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
  const sectorLabel = row.sectorName || row.sectorValue || row.sectorCode || '미지정 섹터';
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

async function fetchTierRules(): Promise<TierRuleDisplay[]> {
  const { db } = await import('@/src/db/client');

  const rows = await db
    .select({
      tier: workerTierRules.tier,
      min: workerTierRules.minPercentage,
      max: workerTierRules.maxPercentage,
      applyStartTime: workerTierRules.applyStartTime,
      applyHorizon: workerTierRules.applyHorizon,
      hourlyWage: workerTierRules.hourlyWage,
      comment: workerTierRules.comment
    })
    .from(workerTierRules)
    .orderBy(workerTierRules.tier);

  return rows.map((row) => {
    const applyStartLabel = normalizeTime(row.applyStartTime) ?? getApplyStartLabel(row.tier);
    const horizonDays = typeof row.applyHorizon === 'number' && row.applyHorizon > 0
      ? row.applyHorizon
      : getApplyHorizonDays(row.tier);
    return {
      tier: row.tier,
      tierLabel: getTierLabel(row.tier),
      rangeLabel: `${row.min} < 퍼센타일 ≤ ${row.max}`,
      applyStartLabel,
      horizonDays,
      hourlyWage: row.hourlyWage ?? null,
      comment: row.comment
    } satisfies TierRuleDisplay;
  });
}

function normalizeTime(value: string | null) {
  if (!value) return null;
  if (value.includes(':')) {
    return value.slice(0, 5);
  }
  return null;
}
