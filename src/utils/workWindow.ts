import { KST, formatKstDateKey, nowKst, toKstDateTime } from '@/src/lib/time';

export type WorkWindowState = 'today' | 'edit' | 'locked';
export type WorkWindowTag = 'D0' | `D+${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

export type WorkWindowMeta = {
  window: WorkWindowState;
  targetDate: string;
  targetTag: WorkWindowTag;
  targetDateLabel: string;
  hostCanEdit: boolean;
  hostCanAdd: boolean;
};

export function getKstNow() {
  return nowKst().toJSDate();
}

export function resolveWorkWindow(baseDate?: Date, forcedDate?: string): WorkWindowMeta {
  const now = baseDate ?? getKstNow();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const targetDate = forcedDate ? parseDateKey(forcedDate) ?? new Date(now) : new Date(now);
  const targetKey = formatDateKey(targetDate);
  const todayKey = formatDateKey(now);
  const diffDays = calculateDiffDays(todayKey, targetKey);

  let hostCanEdit = false;
  let hostCanAdd = false;

  if (diffDays === 1) {
    hostCanEdit = minutes < 16 * 60;
    hostCanAdd = minutes < 16 * 60;
  } else if (diffDays >= 2) {
    hostCanEdit = true;
    hostCanAdd = true;
  }

  const window: WorkWindowState = hostCanEdit || hostCanAdd ? 'today' : 'locked';
  const tag: WorkWindowTag = diffDays <= 0 ? 'D0' : (`D+${Math.min(diffDays, 7)}` as WorkWindowTag);

  return {
    window,
    targetTag: tag,
    targetDate: targetKey,
    targetDateLabel: formatFullDateLabel(targetDate),
    hostCanEdit,
    hostCanAdd
  };
}

export function buildDateOptions(maxDays = 7, baseDate = getKstNow()) {
  const options: { value: string; label: string; tag: WorkWindowTag }[] = [];

  for (let offset = 0; offset <= maxDays; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offset);
    const value = formatDateKey(date);
    const tag = offset === 0 ? 'D0' : (`D+${offset}` as WorkWindowTag);

    options.push({ value, tag, label: formatFullDateLabel(date) });
  }

  return options;
}

export function isDateWithinRange(targetKey: string, maxDays = 7, baseDate = getKstNow()) {
  if (!targetKey) return false;

  const parsed = parseDateKey(targetKey);
  if (!parsed) return false;

  const baseKey = formatDateKey(baseDate);
  const diff = calculateDiffDays(baseKey, targetKey);
  return diff >= 0 && diff <= maxDays;
}

export function formatDateKey(date: Date) {
  return formatKstDateKey(date);
}

function parseDateKey(value: string) {
  const parsed = toKstDateTime(`${value}T00:00:00`).startOf('day');
  return parsed.isValid ? parsed.toJSDate() : null;
}

function calculateDiffDays(baseKey: string, targetKey: string) {
  const base = parseDateKey(baseKey);
  const target = parseDateKey(targetKey);

  if (!base || !target) return 0;

  const diffMs = target.getTime() - base.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

export function formatFullDateLabel(date: Date) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    timeZone: KST
  });

  return formatter.format(date);
}
