import { db } from '@/src/db/client';
import { etcErrorLogs } from '@/src/db/schema';
import { logError as fileLogError } from '@/src/server/logger';

function sanitizeContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) {
    return null;
  }

  try {
    JSON.stringify(context);
    return context;
  } catch (error) {
    console.warn('errorLogs context stringify 실패', error);
    const fallback = { fallback: 'stringify_failed', keys: Object.keys(context) };

    try {
      JSON.stringify(fallback);
      return fallback;
    } catch (fallbackError) {
      console.error('errorLogs fallback stringify 실패', fallbackError);
      return { fallback: 'stringify_failed' };
    }
  }
}

type LogPayload = {
  message: string;
  errorCode?: string | null;
  stacktrace?: string | null;
  level?: number;
  context?: Record<string, unknown> | null;
  userId?: number | null;
  requestId?: string | null;
  appName?: string;
};

export async function logEtcError({
  message,
  errorCode = null,
  stacktrace = null,
  level = 2,
  context = null,
  userId = null,
  requestId = null,
  appName = 'web'
}: LogPayload): Promise<void> {
  const contextJson = sanitizeContext(context);

  try {
    await db.insert(etcErrorLogs).values({
      level,
      appName,
      errorCode: errorCode ?? null,
      message: message.slice(0, 500),
      stacktrace: stacktrace ?? null,
      requestId: requestId ?? null,
      userId: userId ?? null,
      contextJson
    });
  } catch (error) {
    console.error('errorLogs 저장 실패', error);
    // Ensure the failure is still recorded in the file logger for visibility.
    await fileLogError({
      message: 'errorLogs DB insert 실패',
      error,
      context: { appName, message, errorCode, requestId, userId }
    });
  }
}

type ServerErrorPayload = {
  appName?: string;
  message: string;
  error?: unknown;
  errorCode?: string;
  context?: Record<string, unknown> | null;
  requestId?: string | null;
  userId?: number | null;
  level?: number;
};

export async function logServerError({
  appName = 'web',
  message,
  error,
  errorCode,
  context = null,
  requestId = null,
  userId = null,
  level = 2
}: ServerErrorPayload): Promise<void> {
  const stacktrace = error instanceof Error ? error.stack ?? null : null;
  const contextPayload = { ...(context ?? {}), rawError: error instanceof Error ? undefined : error };
  await logEtcError({
    appName,
    message,
    errorCode: errorCode ?? null,
    stacktrace,
    context: Object.keys(contextPayload).length ? contextPayload : null,
    requestId,
    userId,
    level
  });
}
