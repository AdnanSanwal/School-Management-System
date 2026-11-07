import { scopeArgs, TenantViolationError, runWithTenant, runAsSystem, currentSchoolId } from '../../config/tenancy';

const A = 'school-a';
const B = 'school-b';

describe('scopeArgs — reads and bulk writes are pinned to the school', () => {
  it.each(['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy', 'deleteMany', 'delete'])(
    '%s adds schoolId to where',
    (op) => {
      expect(scopeArgs('Student', op, { where: { id: 's1' } }, A).where).toEqual({ id: 's1', schoolId: A });
    },
  );

  it('adds a where clause when none was given', () => {
    expect(scopeArgs('Student', 'findMany', undefined, A)).toEqual({ where: { schoolId: A } });
  });

  it('keeps other args untouched', () => {
    const out = scopeArgs('Student', 'findMany', { where: { name: 'x' }, take: 5, orderBy: { name: 'asc' } }, A);
    expect(out).toEqual({ where: { name: 'x', schoolId: A }, take: 5, orderBy: { name: 'asc' } });
  });

  it('rejects a where that targets another school', () => {
    expect(() => scopeArgs('Student', 'findMany', { where: { schoolId: B } }, A)).toThrow(TenantViolationError);
  });

  it('rejects filter objects on schoolId (e.g. { in: [...] })', () => {
    expect(() => scopeArgs('Student', 'findMany', { where: { schoolId: { in: [A, B] } } }, A)).toThrow(TenantViolationError);
  });

  it('accepts an explicit schoolId equal to the current school', () => {
    expect(scopeArgs('Student', 'findMany', { where: { schoolId: A } }, A).where).toEqual({ schoolId: A });
  });
});

describe('scopeArgs — writes', () => {
  it('create stamps schoolId', () => {
    expect(scopeArgs('Student', 'create', { data: { name: 'x' } }, A).data).toEqual({ name: 'x', schoolId: A });
  });

  it('create refuses another school', () => {
    expect(() => scopeArgs('Student', 'create', { data: { name: 'x', schoolId: B } }, A)).toThrow(TenantViolationError);
  });

  it('create refuses the school relation form', () => {
    expect(() => scopeArgs('Student', 'create', { data: { school: { connect: { id: B } } } }, A)).toThrow(TenantViolationError);
  });

  it('createMany stamps every row', () => {
    const out = scopeArgs('Mark', 'createMany', { data: [{ a: 1 }, { a: 2 }] }, A);
    expect(out.data).toEqual([{ a: 1, schoolId: A }, { a: 2, schoolId: A }]);
  });

  it('createMany refuses a row for another school', () => {
    expect(() => scopeArgs('Mark', 'createMany', { data: [{ a: 1 }, { a: 2, schoolId: B }] }, A)).toThrow(TenantViolationError);
  });

  it('update pins where and refuses moving a row to another school', () => {
    expect(scopeArgs('Student', 'update', { where: { id: 's1' }, data: { name: 'y' } }, A).where).toEqual({ id: 's1', schoolId: A });
    expect(() => scopeArgs('Student', 'update', { where: { id: 's1' }, data: { schoolId: B } }, A)).toThrow(TenantViolationError);
    expect(() => scopeArgs('Student', 'updateMany', { where: {}, data: { schoolId: B } }, A)).toThrow(TenantViolationError);
  });

  it('upsert pins where + create and guards update', () => {
    const out = scopeArgs('PushSubscription', 'upsert', { where: { endpoint: 'e' }, create: { endpoint: 'e' }, update: {} }, A);
    expect(out.where).toEqual({ endpoint: 'e', schoolId: A });
    expect(out.create).toEqual({ endpoint: 'e', schoolId: A });
    expect(() => scopeArgs('PushSubscription', 'upsert', { where: {}, create: {}, update: { schoolId: B } }, A)).toThrow(TenantViolationError);
  });

  it('unknown operations fail closed', () => {
    expect(() => scopeArgs('Student', 'somethingNew', {}, A)).toThrow(TenantViolationError);
  });
});

describe('tenant context', () => {
  it('exposes the current school inside runWithTenant', () => {
    expect(runWithTenant(A, () => currentSchoolId())).toBe(A);
  });

  it('keeps context across awaits', async () => {
    const id = await runWithTenant(A, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentSchoolId();
    });
    expect(id).toBe(A);
  });

  it('currentSchoolId throws outside a school context', () => {
    expect(() => currentSchoolId()).toThrow();
    expect(() => runAsSystem(() => currentSchoolId())).toThrow();
  });
});
