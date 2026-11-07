import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request tenant context.
 *  - `tenant`: a school user; every query on a tenant model is pinned to `schoolId`.
 *  - `system`: trusted code (login, seed, platform admin, background jobs) that
 *    may read across schools. Never derive this from request input.
 */
export type TenantContext =
  | { kind: 'tenant'; schoolId: string }
  | { kind: 'system' };

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Prisma queries are lazy: they run when `.then` is called, and the tenant check
 * reads the context at that moment. If `fn` returns an unawaited query, start it
 * here, inside the context — otherwise it would run (and fail closed) outside it.
 */
function runIn<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, () => {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      return (async () => await result)() as T;
    }
    return result;
  });
}

export function runWithTenant<T>(schoolId: string, fn: () => T): T {
  return runIn({ kind: 'tenant', schoolId }, fn);
}

export function runAsSystem<T>(fn: () => T): T {
  return runIn({ kind: 'system' }, fn);
}

export function currentSchoolId(): string {
  const ctx = tenantStorage.getStore();
  if (ctx?.kind !== 'tenant') throw new Error('No tenant context: this code must run inside a school request');
  return ctx.schoolId;
}

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantViolationError';
  }
}

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany',
]);

function pinWhere(model: string, where: Record<string, any> | undefined, schoolId: string) {
  if (where && 'schoolId' in where && where.schoolId !== schoolId) {
    throw new TenantViolationError(`${model}: query targets another school`);
  }
  return { ...(where ?? {}), schoolId };
}

function pinData(model: string, data: Record<string, any>, schoolId: string) {
  if ('school' in data) {
    throw new TenantViolationError(`${model}: set schoolId as a scalar, not via the school relation`);
  }
  if ('schoolId' in data && data.schoolId !== schoolId) {
    throw new TenantViolationError(`${model}: cannot write a row for another school`);
  }
  return { ...data, schoolId };
}

function guardUpdate(model: string, data: Record<string, any> | undefined, schoolId: string) {
  if (data && 'schoolId' in data && data.schoolId !== schoolId) {
    throw new TenantViolationError(`${model}: cannot move a row to another school`);
  }
}

/**
 * Rewrites top-level Prisma args so they can only touch rows of `schoolId`.
 * Pure function — unit-tested in __tests__/unit/tenancy.test.ts.
 *
 * Limits (by design, keep in mind when writing modules):
 *  - nested writes are not rewritten: write children with their own top-level call;
 *  - foreign keys taken from request input must be checked with `ensureInSchool`
 *    before use, otherwise a row could point at another school's record;
 *  - $queryRaw / $executeRaw are never scoped.
 */
export function scopeArgs(model: string, operation: string, args: any, schoolId: string): any {
  const a = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation)) {
    a.where = pinWhere(model, a.where, schoolId);
    if (operation === 'update' || operation === 'updateMany') guardUpdate(model, a.data, schoolId);
    return a;
  }

  switch (operation) {
    case 'create':
      a.data = pinData(model, a.data ?? {}, schoolId);
      return a;
    case 'createMany':
    case 'createManyAndReturn':
      a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: any) => pinData(model, d, schoolId));
      return a;
    case 'upsert':
      a.where = pinWhere(model, a.where, schoolId);
      a.create = pinData(model, a.create ?? {}, schoolId);
      guardUpdate(model, a.update, schoolId);
      return a;
    default:
      throw new TenantViolationError(`${model}.${operation} is not supported on tenant models`);
  }
}
