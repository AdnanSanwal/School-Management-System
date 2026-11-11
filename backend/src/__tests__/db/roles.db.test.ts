/**
 * Roles & permissions: each school tunes what its staff roles may do.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/roles
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { connectRedis } from '../../config/redis';
import { effectivePermissions } from '../../middleware/rbac';
import { grantable } from '../../utils/rolePermissions';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('role permission rules', () => {
  it('applies a school’s additions and removals to the standard set', () => {
    const o = { ADMIN: { grant: new Set(['finance.view']), revoke: new Set(['fee.collect']) } };
    const perms = effectivePermissions('ADMIN', o);
    expect(perms).toContain('finance.view');
    expect(perms).not.toContain('fee.collect');
    expect(perms).toContain('student.manage');
    expect(effectivePermissions('ACCOUNTANT', o)).toContain('fee.collect'); // other roles untouched
    expect(effectivePermissions('NOBODY')).toEqual([]);
  });
  it('keeps approvals with the principal and teachers inside their classes', () => {
    expect(grantable('PRINCIPAL', 'payroll.approve')).toBe(true);
    expect(grantable('ACCOUNTANT', 'payroll.approve')).toBe(false);
    expect(grantable('ADMIN', 'finance.view')).toBe(true);
    expect(grantable('TEACHER', 'finance.view')).toBe(false);
    expect(grantable('TEACHER', 'notice.publish')).toBe(true);
    expect(grantable('TEACHER', 'marks.enter')).toBe(true); // already standard
    expect(grantable('OWNER', 'finance.manage')).toBe(false);
    expect(grantable('PARENT', 'fee.collect')).toBe(false);
    expect(grantable('ADMIN', 'platform.manage')).toBe(false);
  });
});

d('Roles & permissions (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const as = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    };
  };
  type RoleRow = { role: string; changed: number; users: number; permissions: { key: string; standard: boolean; granted: boolean; available: boolean }[] };
  const role = async (name: string): Promise<RoleRow> => (await as(tok.OWNER).get('/roles')).body.data.roles.find((r: RoleRow) => r.role === name);
  const granted = (r: RoleRow) => r.permissions.filter((p) => p.granted).map((p) => p.key);

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('rol');
    other = await createTestSchool('rol2');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const) tok[r] = (await t.user(r)).token;
    tok.otherAdmin = (await other.user('ADMIN')).token;
    tok.otherOwner = (await other.user('OWNER')).token;
  });
  afterAll(async () => { await t.destroy(); await other.destroy(); });

  it('only the owner sees and changes the roles', async () => {
    for (const r of ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']) expect((await as(tok[r]).get('/roles')).status).toBe(403);
    const m = (await as(tok.OWNER).get('/roles')).body.data;
    expect(m.roles.map((r: RoleRow) => r.role)).toEqual(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']);
    expect(m.modules).toEqual(expect.arrayContaining(['Students', 'Fees', 'Finance & accounting', 'HR & payroll']));
    const admin = m.roles.find((r: RoleRow) => r.role === 'ADMIN');
    expect(admin).toMatchObject({ changed: 0, users: 1 });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'fee.collect')).toMatchObject({ standard: true, granted: true, available: true, module: 'Fees', label: 'Collect fees' });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'finance.view')).toMatchObject({ standard: false, granted: false, available: true });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'payroll.approve')).toMatchObject({ available: false });
  });

  it('a change takes effect at once for that role in that school only', async () => {
    // Before: the office admin collects fees and has no finance access.
    expect((await as(tok.ADMIN).get('/finance/accounts')).status).toBe(403);
    expect((await as(tok.ADMIN).get('/fees/payments')).status).toBe(200);

    const admin = await role('ADMIN');
    const next = granted(admin).filter((p) => p !== 'fee.view').concat('finance.view');
    const saved = await as(tok.OWNER).put('/roles/ADMIN', { permissions: next });
    expect(saved.status).toBe(200);
    expect(saved.body.message).toMatch(/2 changes/);
    expect((await role('ADMIN')).changed).toBe(2);

    expect((await as(tok.ADMIN).get('/finance/accounts')).status).toBe(200);
    expect((await as(tok.ADMIN).get('/fees/payments')).status).toBe(403);
    // What the apps use to show menus.
    const me = (await as(tok.ADMIN).get('/auth/me')).body.data;
    expect(me.permissions).toContain('finance.view');
    expect(me.permissions).not.toContain('fee.view');
    expect(me.permissions).toContain('school.view'); // fixed permissions stay

    // Other roles here, and the same role in another school, are untouched.
    expect((await as(tok.ACCOUNTANT).get('/fees/payments')).status).toBe(200);
    expect((await as(tok.otherAdmin).get('/finance/accounts')).status).toBe(403);
    expect((await as(tok.otherAdmin).get('/fees/payments')).status).toBe(200);
    expect((await as(tok.otherOwner).get('/roles')).body.data.roles.every((r: RoleRow) => r.changed === 0)).toBe(true);
  });

  it('refuses what a role must not have', async () => {
    const O = as(tok.OWNER);
    const acc = granted(await role('ACCOUNTANT'));
    expect((await O.put('/roles/ACCOUNTANT', { permissions: [...acc, 'payroll.approve'] })).status).toBe(422);
    expect((await O.put('/roles/TEACHER', { permissions: [...granted(await role('TEACHER')), 'finance.manage'] })).status).toBe(422);
    expect((await O.put('/roles/ADMIN', { permissions: ['made.up'] })).status).toBe(422);
    expect((await O.put('/roles/ADMIN', { permissions: ['platform.manage'] })).status).toBe(422);
    expect((await O.put('/roles/OWNER', { permissions: [] })).status).toBe(404);
    expect((await O.put('/roles/PARENT', { permissions: [] })).status).toBe(404);
    // The principal can be given an approval; a teacher can publish notices.
    expect((await O.put('/roles/PRINCIPAL', { permissions: [...granted(await role('PRINCIPAL')), 'payroll.approve'] })).status).toBe(200);
    expect((await O.put('/roles/TEACHER', { permissions: [...granted(await role('TEACHER')), 'notice.publish'] })).status).toBe(200);
    expect((await as(tok.PRINCIPAL).get('/auth/me')).body.data.permissions).toContain('payroll.approve');
  });

  it('the owner can’t be locked out, and reset restores the standard set', async () => {
    const O = as(tok.OWNER);
    // Even with everything switched off for the admin, the owner still manages roles.
    expect((await O.put('/roles/ADMIN', { permissions: [] })).status).toBe(200);
    expect((await as(tok.ADMIN).get('/students')).status).toBe(403);
    expect((await as(tok.ADMIN).get('/notices')).status).toBe(200); // everyone still reads notices
    expect((await O.get('/roles')).status).toBe(200);

    const reset = await O.post('/roles/ADMIN/reset');
    expect(reset.status).toBe(200);
    expect((await role('ADMIN')).changed).toBe(0);
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);
    expect((await as(tok.ADMIN).get('/finance/accounts')).status).toBe(403);
    expect((await as(tok.ADMIN).get('/fees/payments')).status).toBe(200);
  });
});
