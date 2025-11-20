import { eq, or } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader } from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';

export type ClientSummary = {
  id: number;
  name: string;
  registerNo: string;
  phone: string;
};

function sanitizeValue(value: string | null | undefined) {
  if (!value || value === '-') {
    return '';
  }

  return value.trim();
}

export async function findClientByProfile(profile: ProfileSummary) {
  const register = sanitizeValue(profile.registerNo);
  const phone = sanitizeValue(profile.phone);
  const clauses = [];

  if (register) {
    clauses.push(eq(clientHeader.registerCode, register));
  }

  if (phone) {
    clauses.push(eq(clientHeader.phone, phone));
  }

  if (clauses.length === 0) {
    return null;
  }

  const whereClause = clauses.length === 1 ? clauses[0] : or(...clauses);

  const [client] = await db
    .select({
      id: clientHeader.id,
      name: clientHeader.name,
      registerNo: clientHeader.registerCode,
      phone: clientHeader.phone
    })
    .from(clientHeader)
    .where(whereClause)
    .limit(1);

  return client ?? null;
}
