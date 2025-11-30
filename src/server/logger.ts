import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = {
  message: string;
  level?: LogLevel;
  context?: Record<string, unknown>;
  error?: unknown;
};

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function safeContext(context?: Record<string, unknown>) {
  if (!context) return undefined;
  try {
    JSON.stringify(context);
    return context;
  } catch (error) {
    return { fallback: 'unserializable', keys: Object.keys(context) };
  }
}

async function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown) {
  ensureLogDir();

  const stack =
    error instanceof Error
      ? error.stack
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object'
          ? JSON.stringify(error)
          : undefined;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: safeContext(context),
    stack
  };

  const line = `${JSON.stringify(payload)}\n`;

  try {
    await fs.promises.appendFile(LOG_FILE, line, { encoding: 'utf8' });
  } catch (fileError) {
    console.error('로그 파일 기록 실패', fileError);
  }

  const consolePayload = { message, context, stack };
  if (level === 'error') {
    console.error('[work-log]', consolePayload);
  } else if (level === 'warn') {
    console.warn('[work-log]', consolePayload);
  } else {
    console.log('[work-log]', consolePayload);
  }
}

export function logInfo(payload: LogPayload) {
  return writeLog('info', payload.message, payload.context, payload.error);
}

export function logWarn(payload: LogPayload) {
  return writeLog('warn', payload.message, payload.context, payload.error);
}

export function logError(payload: LogPayload) {
  return writeLog('error', payload.message, payload.context, payload.error);
}
