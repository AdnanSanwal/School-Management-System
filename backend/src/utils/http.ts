import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import type { JwtPayload } from './jwt';

/** Wraps an async handler so rejected promises reach the error handler. */
export function handler(fn: (req: AuthRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthRequest, res).catch(next);
  };
}

/** Parses req.query with zod; a ZodError becomes a 422 in errorHandler. */
export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.query);
}

export function parseBody<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.body);
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export function paging({ page, limit }: { page: number; limit: number }) {
  return { skip: (page - 1) * limit, take: limit };
}

export function me(req: AuthRequest): JwtPayload {
  return req.user!;
}

/** Common zod pieces. */
export const id = z.string().uuid();
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
export const money = z.coerce.number().nonnegative().max(100_000_000).multipleOf(0.01);

/**
 * The schema for a partial update (PATCH): every field optional, and NO defaults.
 * zod's own `.partial()` keeps `.default()` values, so a field that was not sent would
 * come back filled with its default and silently overwrite what is stored.
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let f = field as ZodTypeAny;
    while (f instanceof z.ZodDefault) f = f.unwrap() as ZodTypeAny;
    shape[key] = f.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
