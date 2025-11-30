import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = {
  message: string;
  level?: LogLevel;
  context?: Record<string, unknown>;
  error?: unknown;
};

const PRIMARY_LOG_DIR = path.resolve(process.cwd(), 'logs');
const FALLBACK_LOG_DIR = path.join(os.tmpdir(), 'tenaCierge-logs');
const PRIMARY_LOG_FILE = path.join(PRIMARY_LOG_DIR, 'app.log');

let currentLogFile = PRIMARY_LOG_FILE;
let hasFallenBack = false;

function ensureLogDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
    ensureLogDir(path.dirname(currentLogFile));
    await fs.promises.appendFile(currentLogFile, line, { encoding: 'utf8' });
  } catch (fileError) {
    if (!hasFallenBack) {
      const fallbackFile = path.join(FALLBACK_LOG_DIR, 'app.log');
      try {
        ensureLogDir(FALLBACK_LOG_DIR);
        await fs.promises.appendFile(fallbackFile, line, { encoding: 'utf8' });
        currentLogFile = fallbackFile;
        hasFallenBack = true;
        console.warn('[work-log] falling back to temp log file', { path: fallbackFile, error: fileError });
      } catch (fallbackError) {
        console.error('로그 파일 기록 실패', fileError);
        console.error('임시 로그 파일 기록 실패', fallbackError);
      }
    } else {
      console.error('로그 파일 기록 실패', fileError);
    }
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

export function getLogFilePath() {
  return currentLogFile;
}
