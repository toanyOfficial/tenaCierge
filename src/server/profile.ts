import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workApply } from '@/src/db/schema';
import { getProfileSummary, type ProfileSummary } from '@/src/utils/profile';
import { formatDateKey, getKstNow } from '@/src/utils/workWindow';
import { findWorkerByProfile } from './workers';

const rolePriority = ['admin', 'host', 'butler', 'cleaner'] as const;

function normalizeRoles(base: ProfileSummary, extra: string[]) {
  const merged = Array.from(new Set([...(base.roles ?? []), ...extra]));
  const filtered = merged.filter((role) => rolePriority.includes(role as (typeof rolePriority)[number]));
  const sorted = filtered.sort(
    (a, b) => rolePriority.indexOf(a as (typeof rolePriority)[number]) - rolePriority.indexOf(b as (typeof rolePriority)[number])
  );

  const primary =
    base.primaryRole && sorted.includes(base.primaryRole)
      ? base.primaryRole
      : sorted.find((role) => rolePriority.includes(role as (typeof rolePriority)[number])) ?? null;

  return { roles: sorted, primaryRole: primary };
}

export async function isButlerEligible(worker: { id: number; tier: number } | null) {
  if (!worker) {
    return false;
  }

  if (worker.tier === 99) {
    return true;
  }

  const now = getKstNow();
  const today = formatDateKey(now);
  const tomorrow = formatDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const targetDates = [today, tomorrow].map((value) => new Date(`${value}T00:00:00+09:00`));

  const butlerRows = await db
    .select({ id: workApply.id })
    .from(workApply)
    .where(and(eq(workApply.workerId, worker.id), eq(workApply.position, 2), inArray(workApply.workDate, targetDates)));

  return butlerRows.length > 0;
}

export async function getProfileWithDynamicRoles(): Promise<ProfileSummary> {
  const base = getProfileSummary();
  const worker = await findWorkerByProfile(base);

  const baseWithoutButler = {
    ...base,
    roles: base.roles.filter((role) => role !== 'butler'),
    primaryRole: base.primaryRole === 'butler' ? null : base.primaryRole
  };

  const butlerEligible = await isButlerEligible(worker);
  const extraRoles = butlerEligible ? ['butler'] : [];
  const normalized = normalizeRoles(baseWithoutButler, extraRoles);

  return { ...baseWithoutButler, ...normalized };
}
