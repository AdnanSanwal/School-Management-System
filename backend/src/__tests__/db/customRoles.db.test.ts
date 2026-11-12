/**
 * Custom roles: a school defines its own access roles (e.g. Receptionist) built on a standard
 * staff role, gives them to logins, and they decide exactly what that login may do.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/customRoles
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { customPermissions } from '../../utils/rolePermissions';
import { signToken } from '../../utils/jwt';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('custom role permission list', () => {
  it('keeps the base role’s fixed parts and only ticks what the base role can be given', () => {
    const perms = customPermissions('ADMIN', ['student.view', 'student.admit', 'payroll.approve', 'platform.manage']);
    expect(perms).toEqual(expect.arrayContaining(['student.view', 'student.admit', 'dashboard.admin', 'notice.view', 'users.manage']));
    expect(perms).not.toContain('payroll.approve'); // approvals stay with the principal
    expect(perms).not.toContain('platform.manage');
    expect(perms).not.toContain('fee.collect'); // standard for admin, but not ticked
  });
});

d('Custom roles (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const as = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    };
  };

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('crole');
    other = await createTestSchool('crole2');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'TEACHER'] as const) tok[r] = (await t.user(r)).token;
    tok.otherOwner = (await other.user('OWNER')).token;
  });
  afterAll(async () => { await t.destroy(); await other.destroy(); });

  let receptionistId = '';
  let userId = '';

  it('only the owner creates roles; names and permissions are checked', async () => {
    const body = { name: 'Receptionist', baseRole: 'ADMIN', permissions: ['student.view', 'student.admit', 'notice.publish'] };
    expect((await as(tok.PRINCIPAL).post('/roles/custom', body)).status).toBe(403);
    expect((await as(tok.OWNER).post('/roles/custom', { ...body, name: 'Office admin' })).status).toBe(409);
    expect((await as(tok.OWNER).post('/roles/custom', { ...body, permissions: ['payroll.approve'] })).status).toBe(422);

    const r = await as(tok.OWNER).post('/roles/custom', body);
    expect(r.status).toBe(201);
    const row = r.body.data.custom.find((c: { name: string }) => c.name === 'Receptionist');
    expect(row).toMatchObject({ baseRole: 'ADMIN', users: 0 });
    expect(row.permissions.sort()).toEqual(['notice.publish', 'student.admit', 'student.view']);
    expect(r.body.data.customChoices.ADMIN.some((c: { key: string }) => c.key === 'fee.collect')).toBe(true);
    receptionistId = row.id;
    expect((await as(tok.OWNER).post('/roles/custom', body)).status).toBe(409); // same name twice
  });

  it('a login with the role can do only what was ticked', async () => {
    const username = `recep.${t.code}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
    const created = await as(tok.OWNER).post('/users', { name: 'Rida Reception', role: 'ADMIN', customRoleId: receptionistId, username, password: 'Initial@123' });
    expect(created.status).toBe(201);
    userId = created.body.data.user.id;
    const u = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = signToken({ id: u.id, role: u.role, email: u.email, schoolId: t.school.id });

    const me = (await as(token).get('/auth/me')).body.data;
    expect(me.customRole).toMatchObject({ id: receptionistId, name: 'Receptionist' });
    expect(me.permissions).toEqual(expect.arrayContaining(['student.view', 'student.admit', 'notice.publish']));
    expect(me.permissions).not.toContain('fee.collect');

    expect((await as(token).get('/students')).status).toBe(200);
    expect((await as(token).get('/fees/payments')).status).toBe(403); // a standard admin could
    expect((await as(tok.ADMIN).get('/fees/payments')).status).toBe(200);

    // Changing the role's list takes effect for its people straight away.
    const saved = await as(tok.OWNER).put(`/roles/custom/${receptionistId}`, { name: 'Front desk', permissions: ['student.view', 'fee.view'] });
    expect(saved.status).toBe(200);
    expect((await as(token).get('/fees/payments')).status).toBe(200);
    expect((await as(token).get('/auth/me')).body.data.customRole.name).toBe('Front desk');

    const list = (await as(tok.OWNER).get('/users')).body.data.find((u: { id: string }) => u.id === userId);
    expect(list.customRole).toMatchObject({ name: 'Front desk' });
  });

  it('a custom role must match the login’s role and belong to the school', async () => {
    const otherRole = await as(tok.otherOwner).post('/roles/custom', { name: 'Clerk', baseRole: 'ADMIN', permissions: ['student.view'] });
    const otherId = otherRole.body.data.custom[0].id;
    expect((await as(tok.OWNER).patch(`/users/${userId}`, { customRoleId: otherId })).status).toBe(422);
    expect((await as(tok.OWNER).patch(`/users/${userId}`, { role: 'ACCOUNTANT', customRoleId: receptionistId })).status).toBe(422);
    // Moving to a standard role drops the custom one.
    const moved = await as(tok.OWNER).patch(`/users/${userId}`, { role: 'ACCOUNTANT' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.customRole).toBeNull();
    expect((await as(tok.OWNER).patch(`/users/${userId}`, { role: 'ADMIN', customRoleId: receptionistId })).body.data.customRole.name).toBe('Front desk');
  });

  it('deleting a role puts its people back on the standard role and is logged', async () => {
    const r = await as(tok.OWNER).del(`/roles/custom/${receptionistId}`);
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/1 person is now office admin/);
    const u = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.customRoleId).toBeNull();
    const logs = await basePrisma.auditLog.findMany({ where: { schoolId: t.school.id, entity: 'roles' }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['Custom role created', 'Custom role changed', 'Custom role deleted']));
  });
});
