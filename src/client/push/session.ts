import { normalizePhone } from '@/src/utils/phone';
import type { SubscriptionContext } from './register';

export type PushIdentity = {
  phone?: string | null;
  registerNo?: string | null;
  roles?: string[] | null;
};

const SESSION_KEY_PREFIX = 'push-check/';

function normalizeRegister(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.toUpperCase() : '';
}

function sanitizePhone(raw: string | null | undefined) {
  const normalized = normalizePhone(raw ?? '');
  return normalized || '';
}

function sanitizeRoles(raw: string[] | null | undefined) {
  return Array.isArray(raw) ? raw.filter((role) => typeof role === 'string' && role.trim() !== '') : [];
}

function buildSessionKey(identity: PushIdentity) {
  const phone = sanitizePhone(identity.phone);
  const registerNo = normalizeRegister(identity.registerNo);
  const roles = sanitizeRoles(identity.roles).sort().join(',');
  return `${SESSION_KEY_PREFIX}${phone}|${registerNo}|${roles}`;
}

export function hasPushCheckRun(identity: PushIdentity) {
  if (typeof window === 'undefined') return false;
  const key = buildSessionKey(identity);
  return window.sessionStorage.getItem(key) === 'done';
}

export function markPushCheckRun(identity: PushIdentity) {
  if (typeof window === 'undefined') return;
  const key = buildSessionKey(identity);
  try {
    window.sessionStorage.setItem(key, 'done');
  } catch (error) {
    // Ignore storage errors to avoid blocking the flow.
    console.warn('push check flag 저장 실패', error);
  }
}

export function resetPushCheckFlags() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(SESSION_KEY_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (error) {
    console.warn('push check flag 초기화 실패', error);
  }
}

export function buildPushContexts(identity: PushIdentity): SubscriptionContext[] {
  const phone = sanitizePhone(identity.phone);
  const registerNo = normalizeRegister(identity.registerNo);
  const roles = sanitizeRoles(identity.roles);

  const contexts: SubscriptionContext[] = [];

  if (roles.includes('host')) {
    contexts.push({ type: 'CLIENT', phone: phone || null, registerNo: registerNo || null });
  }

  if (roles.some((role) => role === 'cleaner' || role === 'butler')) {
    contexts.push({ type: 'WORKER', phone: phone || null, registerNo: registerNo || null });
  }

  return contexts;
}
