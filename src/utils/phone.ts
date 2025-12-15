export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const digitsOnly = raw.replace(/\D/g, '');
  if (!digitsOnly) {
    return null;
  }

  const withoutCountry = digitsOnly.startsWith('82') ? digitsOnly.slice(2) : digitsOnly;
  const candidate = withoutCountry.startsWith('10') ? `0${withoutCountry.slice(0, 10)}` : withoutCountry;
  const trimmed = candidate.slice(0, 11);

  return /^010\d{8}$/.test(trimmed) ? trimmed : null;
}

export function isNormalizedPhone(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^010\d{8}$/.test(value);
}
