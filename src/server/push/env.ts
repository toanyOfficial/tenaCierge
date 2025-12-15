export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function clean(value: string | undefined | null) {
  return value?.trim() ?? '';
}

export function loadVapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig {
  const publicKey = clean(env.VAPID_PUBLIC_KEY);
  const privateKey = clean(env.VAPID_PRIVATE_KEY);
  const subject = clean(env.VAPID_SUBJECT);

  if (!publicKey || !privateKey || !subject) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT 환경 변수를 모두 설정해 주세요.');
  }

  if (!subject.startsWith('mailto:') && !subject.startsWith('http://') && !subject.startsWith('https://')) {
    throw new Error('VAPID_SUBJECT는 mailto: 또는 http(s):// 로 시작해야 합니다.');
  }

  return { publicKey, privateKey, subject };
}

export function getBrowserVapidKey(env: Record<string, string | undefined> = process.env) {
  const key = clean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) || clean(env.VAPID_PUBLIC_KEY);

  if (!key) {
    throw new Error('브라우저용 웹 푸시 퍼블릭 키(NEXT_PUBLIC_VAPID_PUBLIC_KEY)가 설정되어 있지 않습니다.');
  }

  return key;
}
