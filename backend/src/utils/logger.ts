import winston from 'winston';

/**
 * App logger.
 *  - production: one JSON object per line on stdout (Docker/Caddy-friendly, easy to ship
 *    to any log service); development: readable coloured lines.
 *  - LOG_LEVEL overrides the level (default info; debug in development).
 *  - LOG_DIR also writes error.log / combined.log files there (off by default in
 *    production, where stdout is collected by Docker).
 *  - Secrets are masked wherever they appear in log metadata.
 */
const isProd = process.env.NODE_ENV === 'production';
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|otp|mfa|p256dh|auth$|card|cvv|pin/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message' || key === 'timestamp' || key === 'stack') continue;
    (info as any)[key] = SENSITIVE.test(key) ? '[redacted]' : redact((info as any)[key]);
  }
  return info;
});

const transports: winston.transport[] = [new winston.transports.Console()];
const logDir = process.env.LOG_DIR ?? (isProd ? '' : 'logs');
if (logDir && process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.File({ filename: `${logDir}/error.log`, level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 5 }),
    new winston.transports.File({ filename: `${logDir}/combined.log`, maxsize: 20 * 1024 * 1024, maxFiles: 5 }),
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : isProd ? 'info' : 'debug'),
  defaultMeta: { pid: process.pid },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    redactFormat(),
    isProd
      ? winston.format.json()
      : winston.format.printf(({ level, message, timestamp, stack, pid: _pid, ...meta }) => {
        const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${String(timestamp).slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${message}${extra}${stack ? `\n${stack}` : ''}`;
      }),
  ),
  transports,
});

export default logger;
