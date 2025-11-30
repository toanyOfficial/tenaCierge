import { KST_OFFSET_MS } from './kst';
const SIXTEEN_THIRTY_UTC_HOUR = 7; // 16:30 KST == 07:30 UTC
const SIXTEEN_THIRTY_MINUTE = 30;

/**
 * 다음 16:30(서울 기준)에 만료되는 날짜 객체를 반환합니다.
 * - 16:30 이전 생성 시: 오늘 16:30 만료
 * - 16:30 이후 생성 시: 내일 16:30 만료
 */
export function getSeoul1630Expiry(now: Date = new Date()): Date {
  // 서울 시각 기준으로 현재 날짜를 계산하기 위해 9시간을 더한 뒤 UTC 컴포넌트를 사용한다.
  const seoulNow = new Date(now.getTime() + KST_OFFSET_MS);

  const expiryUtc = Date.UTC(
    seoulNow.getUTCFullYear(),
    seoulNow.getUTCMonth(),
    seoulNow.getUTCDate(),
    SIXTEEN_THIRTY_UTC_HOUR,
    SIXTEEN_THIRTY_MINUTE,
    0,
    0
  );

  const target = expiryUtc <= now.getTime()
    ? Date.UTC(
        seoulNow.getUTCFullYear(),
        seoulNow.getUTCMonth(),
        seoulNow.getUTCDate() + 1,
        SIXTEEN_THIRTY_UTC_HOUR,
        SIXTEEN_THIRTY_MINUTE,
        0,
        0
      )
    : expiryUtc;

  return new Date(target);
}
