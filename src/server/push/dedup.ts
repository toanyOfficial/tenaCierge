import { formatDateKey } from '@/src/utils/workWindow';

export enum DedupPrefix {
  CleanSchedule = 'CLEAN_SCHEDULE',
  WorkAssigned = 'WORK_ASSIGNED',
  WorkUnassigned = 'WORK_UNASSIGNED',
  WorkFinishing = 'WORK_FINISHING',
  SupplementsPending = 'SUPPLEMENTS_PENDING',
  WorkApplyOpen = 'WORK_APPLY_OPEN'
}

function normalizePart(part: string | number | Date) {
  if (part instanceof Date) {
    return formatDateKey(part);
  }

  if (typeof part === 'number') {
    if (!Number.isFinite(part)) {
      throw new Error('dedup key numeric segment must be finite');
    }
    return part.toString();
  }

  const trimmed = part.trim();
  if (!trimmed) {
    throw new Error('dedup key segment cannot be empty');
  }
  return trimmed;
}

export function buildDedupKey(prefix: DedupPrefix, ...parts: Array<string | number | Date>) {
  const normalizedParts = parts.map(normalizePart);
  return [prefix, ...normalizedParts].join(':');
}
