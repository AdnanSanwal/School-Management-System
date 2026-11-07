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

export async function connectDatabase() {
  await basePrisma.$connect();
  logger.info('MySQL connected via Prisma');
}

export default prisma;
