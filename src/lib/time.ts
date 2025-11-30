import { DateTime } from 'luxon';

export const KST = 'Asia/Seoul';

export function nowKst() {
  return DateTime.now().setZone(KST);
}

export function toKstDateTime(date: Date | string) {
  return DateTime.fromJSDate(typeof date === 'string' ? new Date(date) : date, { zone: 'utc' }).setZone(KST);
}

export function formatKst(date: Date | string, fmt = 'yyyy-LL-dd HH:mm') {
  return toKstDateTime(date).toFormat(fmt);
}

export function formatKstDateKey(date: Date | string) {
  return toKstDateTime(date).toISODate();
}
