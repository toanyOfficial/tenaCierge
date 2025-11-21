export type WorkWindowState = 'today' | 'batching' | 'edit' | 'locked';
export type WorkWindowTag = 'D0' | 'D+1';

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

export function resolveWorkWindow(baseDate?: Date): WorkWindowMeta {
  const now = baseDate ?? getKstNow();
  const minutes = now.getHours() * 60 + now.getMinutes();

  const targetDate = new Date(now);
  let window: WorkWindowState = 'today';
  let tag: WorkWindowTag = 'D0';
  let hostCanEdit = false;
  let hostCanAdd = false;

  if (minutes <= 14 * 60) {
    window = 'today';
    tag = 'D0';
  } else if (minutes <= 15 * 60) {
    window = 'batching';
    tag = 'D+1';
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (minutes <= 16 * 60) {
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

export function formatDateKey(date: Date) {
  return date.toISOString().split('T')[0];
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
