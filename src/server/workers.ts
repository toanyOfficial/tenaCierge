import { asc, desc, eq, like, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { workerHeader } from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
import { normalizePhone } from '@/src/utils/phone';
import { getTierLabel } from '@/src/utils/tier';

export type WorkerRecord = {
  id: number;
  name: string;
  phone: string | null;
  registerCode: string;
  tier: number;
};

export async function findWorkerByProfile(profile: ProfileSummary) {
  const { phone, registerNo } = profile;
  const normalizedPhone = normalizePhone(phone);
  const normalizedRegister = normalizeIdentifier(registerNo);
  const conditions = [] as ReturnType<typeof eq>[];

  if (normalizedRegister) {
    conditions.push(eq(workerHeader.registerCode, normalizedRegister));
  }

  if (normalizedPhone) {
    conditions.push(eq(workerHeader.phone, normalizedPhone));
  }

  if (!conditions.length) {
    return null;
  }

  const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);

  const rows = await db
    .select({
      id: workerHeader.id,
      name: workerHeader.name,
      phone: workerHeader.phone,
      registerCode: workerHeader.registerCode,
      tier: workerHeader.tier
    })
    .from(workerHeader)
    .where(whereClause)
    .limit(1);

  return rows[0] ?? null;
}

export async function findWorkerById(workerId: number) {
  const rows = await db
    .select({
      id: workerHeader.id,
      name: workerHeader.name,
      phone: workerHeader.phone,
      registerCode: workerHeader.registerCode,
      tier: workerHeader.tier
    })
    .from(workerHeader)
    .where(eq(workerHeader.id, workerId))
    .limit(1);

  return rows[0] ?? null;
}

export async function searchWorkersByTerm(term: string, limit = 10) {
  const trimmed = term.trim();

  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/[^0-9a-zA-Z]/g, '');
  const phonePattern = normalized ? `%${normalized}%` : null;
  const namePattern = `%${trimmed}%`;
  const clauses = [
    phonePattern ? like(workerHeader.phone, phonePattern) : null,
    phonePattern ? like(workerHeader.registerCode, phonePattern) : null,
    like(workerHeader.name, namePattern)
  ].filter(Boolean) as ReturnType<typeof like>[];
  const rows = await db
    .select({
      id: workerHeader.id,
      name: workerHeader.name,
      phone: workerHeader.phone,
      registerCode: workerHeader.registerCode,
      tier: workerHeader.tier
    })
    .from(workerHeader)
    .where(or(...clauses))
    .orderBy(desc(workerHeader.tier), asc(workerHeader.name))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    tierLabel: getTierLabel(row.tier)
  }));
}

function normalizeIdentifier(value: string | undefined) {
  if (!value) {
    return '';
  }

  return value.trim().toUpperCase();
}
