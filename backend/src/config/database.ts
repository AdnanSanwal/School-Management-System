import { Prisma, PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { scopeArgs, tenantStorage, TenantViolationError } from './tenancy';

/**
 * Unscoped client. Only for trusted cross-school code: auth (login/refresh),
 * platform admin, seed, background jobs. Module code must use the default export.
 */
export const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Every model with a `schoolId` column is a tenant model.
export const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'schoolId'))
    .map((m) => m.name),
);

/**
 * Tenant-scoped client. Inside a school request every query on a tenant model is
 * pinned to that school; outside any context it refuses to run, so a forgotten
 * `authenticate` middleware fails loudly instead of leaking data.
 */
const prisma = basePrisma.$extends({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const ctx = tenantStorage.getStore();
        if (!ctx) throw new TenantViolationError(`${model}.${operation} called without tenant context`);
        if (ctx.kind === 'system') return query(args);
        return query(scopeArgs(model, operation, args, ctx.schoolId));
      },
    },
  },
});

export type ScopedPrisma = typeof prisma;
/** The `tx` handed to `prisma.$transaction(async (tx) => ...)` — still tenant-scoped. */
export type ScopedTx = Parameters<Parameters<ScopedPrisma['$transaction']>[0]>[0];

/** MySQL deadlock / write conflict, surfaced by Prisma as P2034 (or raw 1213/1205). */
export function isRetryableTxError(err: unknown) {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return e?.code === 'P2034' || e?.meta?.code === '1213' || /deadlock|lock wait timeout/i.test(e?.message ?? '');
}

/**
 * Unique-constraint violation (P2002). Inside our write transactions this is
 * usually an upsert race — two requests both "create" the same attendance row
 * or the same school's first counter — and a re-run takes the update path.
 * A genuine duplicate (an email already in use) fails again and still ends as 409.
 */
function isUniqueRace(err: unknown) {
  return (err as { code?: string })?.code === 'P2002';
}

/**
 * Interactive transaction that retries when MySQL aborts it for a deadlock or
 * an upsert race. Concurrent writers to the same unique index (two schools saving
 * subject teachers, a teacher and the office saving one section's attendance)
 * can deadlock on InnoDB gap locks; the loser is rolled back and is safe to re-run.
 * Use this instead of prisma.$transaction(async tx => …).
 */
export async function transaction<T>(fn: (tx: ScopedTx) => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 15_000 });
    } catch (err) {
      const retry = isRetryableTxError(err) || isUniqueRace(err);
      if (i >= attempts || !retry) throw err;
      logger.warn('Retrying transaction', { attempt: i, reason: isUniqueRace(err) ? 'unique race' : 'deadlock' });
      await new Promise((r) => setTimeout(r, 25 * 2 ** i + Math.random() * 50));
    }
  }
}

/** Connects at start-up, retrying with back-off while MySQL is still starting (e.g. after a reboot). */
export async function connectDatabase(attempts = Number(process.env.DB_CONNECT_ATTEMPTS) || 10) {
  for (let i = 1; ; i++) {
    try {
      await basePrisma.$connect();
      logger.info('MySQL connected via Prisma');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      const wait = Math.min(1000 * 2 ** (i - 1), 10_000);
      logger.warn(`MySQL not reachable (attempt ${i}/${attempts}); retrying in ${wait} ms`, { error: (err as Error).message.split('\n')[0] });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export default prisma;
