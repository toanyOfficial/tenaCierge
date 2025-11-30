export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Return the current time in KST.
 * Optionally accepts a base Date so callers can mock or reuse a timestamp.
 */
export function nowInKst(base: Date = new Date()): Date {
  return new Date(base.getTime() + KST_OFFSET_MS);
}
