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
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

export function resolveWorkWindow(baseDate?: Date, forcedDate?: string): WorkWindowMeta {
  const now = baseDate ?? getKstNow();
  const minutes = now.getHours() * 60 + now.getMinutes();

  const targetDate = forcedDate ? parseDateKey(forcedDate) ?? new Date(now) : new Date(now);
  const todayKey = formatDateKey(now);
  const diffDays = calculateDiffDays(todayKey, formatDateKey(targetDate));
  let window: WorkWindowState = 'today';
  let tag: WorkWindowTag = 'D0';
  let hostCanEdit = false;
  let hostCanAdd = false;

  if (forcedDate) {
    if (diffDays >= 1) {
      tag = (`D+${Math.min(diffDays, 7)}` as WorkWindowTag) ?? 'D0';
      window = 'locked';
    } else {
      tag = 'D0';
      window = minutes < 14 * 60 ? 'today' : 'locked';
    }
  } else if (minutes < 14 * 60) {
    window = 'today';
    tag = 'D0';
  } else if (minutes < 16 * 60) {
    window = 'edit';
    tag = 'D+1';
    targetDate.setDate(targetDate.getDate() + 1);
    hostCanEdit = true;
    hostCanAdd = true;
  } else {
    window = 'locked';
    tag = 'D+1';
    targetDate.setDate(targetDate.getDate() + 1);
  }

  return {
    window,
    targetTag: tag,
    targetDate: formatDateKey(targetDate),
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
    const tag = (offset === 0 ? 'D0' : (`D+${offset}` as WorkWindowTag)) ?? 'D0';

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
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const safe = `${value}T00:00:00+09:00`;
  const parsed = new Date(safe);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    weekday: 'short'
  });

  return formatter.format(date);
}
