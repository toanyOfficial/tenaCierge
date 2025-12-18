const fingerprintCache: { value: string | null; promise?: Promise<string | null> } = { value: null };

function buildFingerprintSeed() {
  if (typeof navigator === 'undefined' || typeof screen === 'undefined') return null;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const width = typeof screen.width === 'number' ? screen.width : 0;
  const height = typeof screen.height === 'number' ? screen.height : 0;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

  return `${ua}__${platform}__${width}x${height}__${timeZone}`;
}

async function hashString(value: string) {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback hash for environments without subtle crypto (deterministic but weaker)
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return `fallback-${Math.abs(hash).toString(16)}`;
}

export async function getDeviceFingerprint(): Promise<string | null> {
  if (fingerprintCache.value) return fingerprintCache.value;
  if (fingerprintCache.promise) return fingerprintCache.promise;

  const seed = buildFingerprintSeed();
  if (!seed) {
    fingerprintCache.value = null;
    return null;
  }

  fingerprintCache.promise = hashString(seed)
    .then((hashed) => {
      fingerprintCache.value = hashed;
      return hashed;
    })
    .catch((error) => {
      console.warn('디바이스 fingerprint 계산 실패', error);
      fingerprintCache.value = null;
      return null;
    });

  return fingerprintCache.promise;
}
