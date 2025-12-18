import { normalizePhone } from '@/src/utils/phone';
import type { SubscriptionContext } from './types';

export type PushIdentity = {
  phone?: string | null;
  registerNo?: string | null;
  roles?: string[] | null;
};

export type PushSessionState = {
  status: 'succeeded' | 'denied' | 'prompted';
  lastUpdated: number;
};

const SESSION_KEY_PREFIX = 'push-session/';

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

function readState(identity: PushIdentity): PushSessionState | null {
  if (typeof window === 'undefined') return null;
  const key = buildSessionKey(identity);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PushSessionState;
    if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
      return parsed;
    }
  } catch (error) {
    // ignore corrupted state
  }

  return null;
}

function writeState(identity: PushIdentity, state: PushSessionState) {
  if (typeof window === 'undefined') return;
  const key = buildSessionKey(identity);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn('push session 저장 실패', error);
  }
}

export function markPushSuccess(identity: PushIdentity) {
  writeState(identity, { status: 'succeeded', lastUpdated: Date.now() });
}

export function markPushDenied(identity: PushIdentity) {
  writeState(identity, { status: 'denied', lastUpdated: Date.now() });
}

export function markPushPrompted(identity: PushIdentity) {
  writeState(identity, { status: 'prompted', lastUpdated: Date.now() });
}

export function clearPushSession(identity: PushIdentity) {
  if (typeof window === 'undefined') return;
  const key = buildSessionKey(identity);
  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('push session 제거 실패', error);
  }
}

export function resetPushSessionFlags() {
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
    console.warn('push session 초기화 실패', error);
  }
}

export function shouldRetry(identity: PushIdentity) {
  const state = readState(identity);
  return !state || state.status !== 'succeeded';
}

export function getLastPushState(identity: PushIdentity) {
  return readState(identity);
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
