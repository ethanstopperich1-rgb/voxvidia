export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMeta {
  callId?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function log(level: LogLevel, message: string, meta?: LogMeta): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (meta?.callId) {
    entry.callId = meta.callId;
  }

  if (meta) {
    const { callId, ...rest } = meta;
    if (Object.keys(rest).length > 0) {
      entry.meta = rest;
    }
  }

  process.stdout.write(JSON.stringify(entry) + '\n');
}

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

export function createLogger(prefix: string): Logger {
  const prefixed = (level: LogLevel, message: string, meta?: LogMeta) => {
    log(level, `[${prefix}] ${message}`, meta);
  };

  return {
    debug: (message, meta?) => prefixed('debug', message, meta),
    info: (message, meta?) => prefixed('info', message, meta),
    warn: (message, meta?) => prefixed('warn', message, meta),
    error: (message, meta?) => prefixed('error', message, meta),
  };
}

export { log };
