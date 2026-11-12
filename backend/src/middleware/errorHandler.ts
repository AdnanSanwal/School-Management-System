import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { TenantViolationError } from '../config/tenancy';

/** An expected failure with a message that is safe to show the user. */
export class AppError extends Error {
  constructor(public message: string, public statusCode = 500, public isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

type Reply = { status: number; message: string; errors?: { field: string; message: string }[] };

/** Maps any thrown value to a status + safe message. Unknown errors become a generic 500. */
function classify(err: any): Reply | null {
  if (err instanceof AppError) return { status: err.statusCode, message: err.message };
  if (err instanceof ZodError) {
    return { status: 422, message: 'Validation error', errors: err.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) };
  }
  if (err instanceof MulterError) {
    return err.code === 'LIMIT_FILE_SIZE' ? { status: 413, message: 'File is larger than 5 MB' } : { status: 422, message: err.message };
  }
  if (err instanceof TenantViolationError) return { status: 403, message: 'Forbidden' };

  // body-parser: malformed JSON, oversized body, wrong charset
  if (err?.type === 'entity.parse.failed') return { status: 400, message: 'Malformed JSON in request body' };
  if (err?.type === 'entity.too.large') return { status: 413, message: 'Request body is too large' };
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.expose) return { status: err.status, message: err.message };

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': return { status: 409, message: 'This already exists' };
      case 'P2025': return { status: 404, message: 'Not found' };
      case 'P2003': return { status: 409, message: 'This is still linked to other records' };
      case 'P2034': return { status: 409, message: 'Someone else changed this at the same time. Please try again.' };
      case 'P2024': return { status: 503, message: 'The server is busy. Please try again in a moment.' }; // pool timeout
      default: return null;
    }
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return { status: 503, message: 'Database unavailable. Please try again shortly.' };
  if (err instanceof Prisma.PrismaClientValidationError) return { status: 422, message: 'Invalid request' };
  return null;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const reply = classify(err);
  const ctx = { requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], userId: (req as any).user?.id };

  if (reply) {
    if (err instanceof TenantViolationError) logger.warn('Tenant violation blocked', { ...ctx, message: err.message });
    else if (reply.status >= 500) logger.error(reply.message, { ...ctx, error: err });
  } else {
    logger.error('Unhandled error', { ...ctx, error: err.message, stack: err.stack });
  }

  if (res.headersSent) return; // e.g. a streamed PDF failed half-way: nothing more can be sent
  const status = reply?.status ?? 500;
  return res.status(status).json({
    success: false,
    message: reply?.message ?? 'Something went wrong on our side. Please try again.',
    ...(reply?.errors ? { errors: reply.errors } : {}),
    // Quote this to support to find the exact log lines.
    ...(status >= 500 ? { requestId: req.id } : {}),
  });
}
