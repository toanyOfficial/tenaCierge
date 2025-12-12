import { getProfileSummary } from '@/src/utils/profile';

const DEFAULT_WEB_ACTOR = '-';
export const BATCH_ACTOR = 'BATCH';

export function resolveWebActor(): string {
  const registerNo = getProfileSummary().registerNo?.trim();
  return registerNo && registerNo.length > 0 ? registerNo : DEFAULT_WEB_ACTOR;
}

export function withInsertAuditFields<T extends Record<string, unknown>>(values: T, actor = resolveWebActor()) {
  return { ...values, createdBy: actor, updatedBy: actor };
}

export function withUpdateAuditFields<T extends Record<string, unknown>>(values: T, actor = resolveWebActor()) {
  const { createdBy, ...rest } = values;
  return { ...rest, updatedBy: actor } as Omit<typeof rest, 'createdBy'> & { updatedBy: string };
}
