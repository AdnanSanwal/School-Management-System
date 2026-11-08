import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates the access log, error logs and the response (X-Request-Id). */
      id: string;
    }
  }
}

const VALID_ID = /^[A-Za-z0-9._-]{8,100}$/;
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 500;

/**
 * Gives every request an id (kept from the proxy's X-Request-Id when it looks sane),
 * returns it in the response, and writes one structured access-log line per request.
 * Query strings are never logged: signed file links carry their signature there.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const user = (req as any).user as { id?: string; schoolId?: string | null; role?: string } | undefined;
    const entry = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms,
      ip: req.ip,
      userId: user?.id,
      schoolId: user?.schoolId ?? undefined,
    };
    if (req.path === '/health' || req.path === '/ready') return; // health probes would drown the log
    if (res.statusCode >= 500) logger.error('request failed', entry);
    else if (ms >= SLOW_MS) logger.warn(`slow request ${ms} ms`, entry);
    else logger.info('request', entry);
  });
  next();
}
