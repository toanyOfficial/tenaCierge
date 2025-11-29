'use client';

import { useEffect } from 'react';

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [0-9]+ failed/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i
];

function isChunkLoadErrorFromEvent(event: ErrorEvent | PromiseRejectionEvent): boolean {
  const reason: unknown = (event as PromiseRejectionEvent).reason ?? (event as ErrorEvent).error ?? event;
  const message =
    (typeof reason === 'string' ? reason : '') ||
    (reason instanceof Error ? reason.message : '') ||
    (reason as ErrorEvent | PromiseRejectionEvent)?.type ||
    '';

  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function shouldReload(): boolean {
  try {
    const markerKey = 'chunk-reload-attempt';
    const lastAttempt = sessionStorage.getItem(markerKey);
    const now = Date.now();

    if (lastAttempt) {
      const lastAttemptTime = Number(lastAttempt);
      // avoid reload loops; allow another attempt after 30 seconds
      if (!Number.isNaN(lastAttemptTime) && now - lastAttemptTime < 30_000) {
        return false;
      }
    }

    sessionStorage.setItem(markerKey, String(now));
  } catch (error) {
    // ignore storage errors, still attempt reload
  }

  return true;
}

export default function ChunkLoadRecovery() {
  useEffect(() => {
    const reloadIfChunkFailure = (event: ErrorEvent | PromiseRejectionEvent) => {
      if (!isChunkLoadErrorFromEvent(event)) return;
      if (!shouldReload()) return;

      // Force a hard reload to fetch a fresh client bundle
      window.location.reload();
    };

    window.addEventListener('error', reloadIfChunkFailure);
    window.addEventListener('unhandledrejection', reloadIfChunkFailure);

    return () => {
      window.removeEventListener('error', reloadIfChunkFailure);
      window.removeEventListener('unhandledrejection', reloadIfChunkFailure);
    };
  }, []);

  return null;
}
