export function parseTimeString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function minutesToTimeString(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (normalized % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function clampMinutes(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function addMinutes(time: string, minutesToAdd: number) {
  const minutes = parseTimeString(time);

  if (minutes === null) {
    return null;
  }

  return minutesToTimeString(minutes + minutesToAdd);
}

export function normalizeTimeInput(value: string | null | undefined) {
  const minutes = parseTimeString(value ?? undefined);

  if (minutes === null) {
    return null;
  }

  return minutesToTimeString(minutes);
}
