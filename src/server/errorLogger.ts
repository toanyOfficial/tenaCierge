import { db } from '@/src/db/client';
import { etcErrorLogs } from '@/src/db/schema';

type ErrorLogInput = {
  appName: string;
  errorCode?: string;
  message: string;
  error?: unknown;
  requestId?: string;
};

export async function logServerError({ appName, errorCode, message, error, requestId }: ErrorLogInput) {
  try {
    const err = error instanceof Error ? error : undefined;
    const stacktrace = err?.stack?.slice(0, 2000) ?? null;
    const summary = err?.message ? `${message}: ${err.message}` : message;

    await db.insert(etcErrorLogs).values({
      level: 2,
      appName,
      errorCode: errorCode ?? null,
      message: summary.slice(0, 500),
      stacktrace,
      requestId: requestId ?? null,
      contextJson: err ? JSON.stringify({ name: err.name }) : null
    });
  } catch (loggingError) {
    console.error('Failed to log server error', loggingError);
  }
}
