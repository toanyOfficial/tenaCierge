import { DateTime } from 'luxon';

const KST = 'Asia/Seoul';

export function nowKst() {
  return DateTime.now().setZone(KST);
}

export function formatKst(date: Date | string, fmt = 'yyyy-LL-dd HH:mm') {
  return DateTime.fromJSDate(typeof date === 'string' ? new Date(date) : date)
    .setZone(KST)
    .toFormat(fmt);
}
