import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { TenantViolationError } from '../config/tenancy';

export class AppError extends Error {
  constructor(public message: string, public statusCode = 500, public isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: 'Validation error',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
    return res.status(status).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : err.message });
  }

  if (err instanceof TenantViolationError) {
    logger.warn('Tenant violation blocked', { message: err.message });
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const code = (err as any).code;
  // Prisma unique constraint violation
  if (code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Resource already exists' });
  }
  // Record not found (also what a scoped lookup of another school's ID returns)
  if (code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }

  logger.error('Unhandled error', err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}
