/**
 * Roles & permissions: each school tunes what its roles may do and which logins each
 * staff role may create; student and parent logins are linked to their records.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/roles
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { effectivePermissions } from '../../middleware/rbac';
import { creatableRoles } from '../../utils/accounts';
import { changeable, grantable } from '../../utils/rolePermissions';
import { createTestSchool, tokenFor } from './helpers';

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
    expect(grantable('ADMIN', 'platform.manage')).toBe(false);
  });
  it('parents and students keep their own view; only a few parts can be switched', () => {
    expect(grantable('PARENT', 'fee.collect')).toBe(false);
    expect(changeable('PARENT', 'fee.pay')).toBe(true);
    expect(changeable('PARENT', 'attendance.student.view')).toBe(false); // always on
    expect(changeable('STUDENT', 'fee.view')).toBe(true);                // can be switched on
    expect(changeable('STUDENT', 'fee.pay')).toBe(false);
  });
  it('who may create which logins: standard, and with a school’s choices', () => {
    expect(creatableRoles('OWNER')).toEqual(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
    expect(creatableRoles('PRINCIPAL')).toEqual(['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
    expect(creatableRoles('ADMIN')).toEqual(['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
    expect(creatableRoles('ACCOUNTANT')).toEqual([]);
    expect(creatableRoles('PARENT')).toEqual([]);
    const o = {
      ACCOUNTANT: { grant: new Set(['create:STUDENT', 'create:OWNER']), revoke: new Set<string>() },
      PRINCIPAL: { grant: new Set<string>(), revoke: new Set(['create:ADMIN', 'create:ACCOUNTANT']) },
    };
    expect(creatableRoles('ACCOUNTANT', o)).toEqual(['STUDENT']); // never the owner, whatever is stored
    expect(creatableRoles('PRINCIPAL', o)).toEqual(['TEACHER', 'PARENT', 'STUDENT']);
  });
});

d('Roles & permissions (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    };
  };
  type RoleRow = {
    role: string; editable: boolean; changed: number; users: number;
    permissions: { key: string; module: string; label: string; standard: boolean; granted: boolean; available: boolean }[];
    creates: { role: string; standard: boolean; allowed: boolean; available: boolean }[];
  };
  const role = async (name: string): Promise<RoleRow> => (await as(tok.OWNER).get('/roles')).body.data.roles.find((r: RoleRow) => r.role === name);
  const granted = (r: RoleRow) => r.permissions.filter((p) => p.granted).map((p) => p.key);
  const uname = (s: string) => `${s}.${t.code}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const newUser = (token: string, r: string, name: string) => as(token).post('/users', { name: `${name} Person`, role: r, username: uname(name), password: 'Initial@123' });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('rol');
    other = await createTestSchool('rol2');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const) tok[r] = (await t.user(r)).token;
    tok.otherAdmin = (await other.user('ADMIN')).token;
    tok.otherOwner = (await other.user('OWNER')).token;
  });
  afterAll(async () => { await t.destroy(); await other.destroy(); });

  it('the owner sees every role; only the owner changes them', async () => {
    for (const r of ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']) expect((await as(tok[r]).get('/roles')).status).toBe(403);
    const m = (await as(tok.OWNER).get('/roles')).body.data;
    expect(m.roles.map((r: RoleRow) => r.role)).toEqual(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
    expect(m.roles[0]).toMatchObject({ editable: false, users: 1 });
    expect(m.roles[0].creates.every((c: { allowed: boolean }) => c.allowed)).toBe(true);

    const admin = m.roles.find((r: RoleRow) => r.role === 'ADMIN');
    expect(admin).toMatchObject({ editable: true, changed: 0, users: 1 });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'fee.collect')).toMatchObject({ standard: true, granted: true, available: true, module: 'Fees', label: 'Collect fees' });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'finance.view')).toMatchObject({ standard: false, granted: false, available: true });
    expect(admin.permissions.find((p: { key: string }) => p.key === 'payroll.approve')).toMatchObject({ available: false });
    expect(admin.creates.map((c: { role: string; allowed: boolean }) => [c.role, c.allowed])).toEqual([['ACCOUNTANT', true], ['TEACHER', true], ['PARENT', true], ['STUDENT', true]]);

    const student = m.roles.find((r: RoleRow) => r.role === 'STUDENT');
    expect(student.creates).toEqual([]);
    expect(student.permissions.find((p: { key: string }) => p.key === 'attendance.student.view')).toMatchObject({ granted: true, available: false, label: 'See attendance' });
    expect(student.permissions.find((p: { key: string }) => p.key === 'fee.view')).toMatchObject({ granted: false, available: true });
    expect(m.roles.find((r: RoleRow) => r.role === 'PARENT').permissions.find((p: { key: string }) => p.key === 'fee.pay')).toMatchObject({ granted: true, available: true });
  });

  it('a change takes effect at once for that role in that school only', async () => {
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
    const me = (await as(tok.ADMIN).get('/auth/me')).body.data;
    expect(me.permissions).toContain('finance.view');
    expect(me.permissions).not.toContain('fee.view');
    expect(me.permissions).toContain('school.view'); // fixed permissions stay
    expect(me.creatableRoles).toEqual(['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']); // untouched by a permissions-only save

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
    expect((await O.put('/roles/SUPER_ADMIN', { permissions: [] })).status).toBe(404);
    // A parent's own view can't be removed, and they can't be given office work.
    const parent = granted(await role('PARENT'));
    expect((await O.put('/roles/PARENT', { permissions: parent.filter((p) => p !== 'attendance.student.view') })).status).toBe(422);
    expect((await O.put('/roles/PARENT', { permissions: [...parent, 'fee.collect'] })).status).toBe(422);
    expect((await O.put('/roles/PARENT', { permissions: parent, creates: ['STUDENT'] })).status).toBe(422);
    // The principal can be given an approval; a teacher can publish notices.
    expect((await O.put('/roles/PRINCIPAL', { permissions: [...granted(await role('PRINCIPAL')), 'payroll.approve'] })).status).toBe(200);
    expect((await O.put('/roles/TEACHER', { permissions: [...granted(await role('TEACHER')), 'notice.publish'] })).status).toBe(200);
    expect((await as(tok.PRINCIPAL).get('/auth/me')).body.data.permissions).toContain('payroll.approve');
  });

  it('the owner decides which logins each role may create', async () => {
    const O = as(tok.OWNER);
    // Standard: the office admin creates accountants; the accountant creates nobody.
    expect((await newUser(tok.ADMIN, 'ACCOUNTANT', 'acc.one')).status).toBe(201);
    expect((await newUser(tok.ADMIN, 'PRINCIPAL', 'prin.one')).status).toBe(403);
    expect((await newUser(tok.ACCOUNTANT, 'TEACHER', 'teach.one')).status).toBe(403);
    expect((await as(tok.ACCOUNTANT).get('/auth/me')).body.data).toMatchObject({ creatableRoles: [] });

    // The owner lets the accountant create teacher and student logins.
    const acc = await role('ACCOUNTANT');
    const saved = await O.put('/roles/ACCOUNTANT', { permissions: granted(acc), creates: ['TEACHER', 'STUDENT'] });
    expect(saved.status).toBe(200);
    const me = (await as(tok.ACCOUNTANT).get('/auth/me')).body.data;
    expect(me.creatableRoles).toEqual(['TEACHER', 'STUDENT']);
    expect(me.permissions).toContain('users.manage'); // opens Users & logins
    expect((await newUser(tok.ACCOUNTANT, 'TEACHER', 'teach.one')).status).toBe(201);
    expect((await newUser(tok.ACCOUNTANT, 'PARENT', 'par.one')).status).toBe(403);
    expect((await newUser(tok.ACCOUNTANT, 'ADMIN', 'adm.one')).status).toBe(403);
    expect((await role('ACCOUNTANT')).creates.map((c) => [c.role, c.allowed])).toEqual([['TEACHER', true], ['PARENT', false], ['STUDENT', true]]);

    // A role can't be allowed to create its own rank or above.
    expect((await O.put('/roles/ACCOUNTANT', { permissions: granted(acc), creates: ['ADMIN'] })).status).toBe(422);
    expect((await O.put('/roles/ADMIN', { permissions: granted(await role('ADMIN')), creates: ['PRINCIPAL'] })).status).toBe(422);
    expect((await O.put('/roles/PRINCIPAL', { permissions: granted(await role('PRINCIPAL')), creates: ['OWNER'] })).status).toBe(422);

    // The principal is limited to teachers; with nothing allowed, Users & logins closes.
    const prin = granted(await role('PRINCIPAL'));
    await O.put('/roles/PRINCIPAL', { permissions: prin, creates: ['TEACHER'] });
    expect((await newUser(tok.PRINCIPAL, 'TEACHER', 'teach.two')).status).toBe(201);
    expect((await newUser(tok.PRINCIPAL, 'ADMIN', 'adm.two')).status).toBe(403);
    await O.put('/roles/PRINCIPAL', { permissions: prin, creates: [] });
    expect((await as(tok.PRINCIPAL).get('/users')).status).toBe(403);
    expect((await as(tok.PRINCIPAL).get('/auth/me')).body.data.permissions).not.toContain('users.manage');

    // The owner still creates anyone, and another school is untouched.
    expect((await newUser(tok.OWNER, 'PRINCIPAL', 'prin.two')).status).toBe(201);
    expect((await as(tok.otherAdmin).get('/auth/me')).body.data.creatableRoles).toEqual(['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
  });

  it('a student login is linked to the student and sees only that student', async () => {
    const O = as(tok.OWNER);
    const cls = await O.post('/roles/ADMIN/reset').then(() => as(tok.ADMIN).post('/academics/classes', { name: 'Class 9', level: 9, sections: ['A'] }));
    const admit = (name: string, phone: string) => as(tok.ADMIN).post('/students', { name, sectionId: cls.body.data.sections[0].id, monthlyFee: 2000, guardians: [{ name: `${name} Parent`, phone, relation: 'FATHER', isPrimary: true }] });
    ids.zara = (await admit('Zara Student', '03007770001')).body.data.student.id;
    ids.omar = (await admit('Omar Student', '03007770002')).body.data.student.id;

    expect((await as(tok.TEACHER).post(`/students/${ids.zara}/login`, { username: uname('zara') })).status).toBe(403);
    expect((await as(tok.ADMIN).post(`/students/${ids.zara}/login`, {})).status).toBe(422);
    const made = await as(tok.ADMIN).post(`/students/${ids.zara}/login`, { username: uname('zara') });
    expect(made.status).toBe(201);
    expect(made.body.data.user).toMatchObject({ role: 'STUDENT', username: uname('zara') });
    expect(made.body.data.temporaryPassword).toEqual(expect.any(String));
    expect((await as(tok.ADMIN).post(`/students/${ids.zara}/login`, { username: uname('zara2') })).status).toBe(409);
    expect((await as(tok.ADMIN).get(`/students/${ids.zara}`)).body.data.user).toMatchObject({ username: uname('zara') });

    const user = await basePrisma.user.findUniqueOrThrow({ where: { id: made.body.data.user.id } });
    expect(user.mustChangePassword).toBe(true);
    const S = as(tokenFor(user));
    const mine = await S.get('/family/children');
    expect(mine.body.data.map((k: { name: string }) => k.name)).toEqual(['Zara Student']);
    expect((await S.get(`/family/home?studentId=${ids.zara}`)).status).toBe(200);
    expect((await S.get(`/family/home?studentId=${ids.omar}`)).status).toBe(404);
    expect((await S.get(`/students/${ids.omar}`)).status).toBe(404);
    expect((await S.get('/staff')).status).toBe(403);
    // Fees are a parent's business unless the school switches them on for students.
    expect((await S.get(`/fees/students/${ids.zara}`)).status).toBe(403);
    expect((await S.get(`/family/home?studentId=${ids.zara}`)).body.data.fees ?? null).toBeNull();
    expect((await O.put('/roles/STUDENT', { permissions: [...granted(await role('STUDENT')), 'fee.view'] })).status).toBe(200);
    expect((await S.get(`/fees/students/${ids.zara}`)).status).toBe(200);
    expect((await S.get(`/fees/students/${ids.omar}`)).status).toBe(404);
    expect((await S.get('/auth/me')).body.data.permissions).toContain('fee.view');
  });

  it('a parent login can use a username and covers only their own children', async () => {
    const detail = (await as(tok.ADMIN).get(`/students/${ids.omar}`)).body.data;
    const guardianId = detail.guardians[0].guardian.id;
    const made = await as(tok.ADMIN).post(`/students/guardians/${guardianId}/login`, { username: uname('omar.dad'), password: 'Parent@1234' });
    expect(made.status).toBe(201);
    expect(made.body.data.user).toMatchObject({ role: 'PARENT', username: uname('omar.dad'), email: null });
    expect((await as(tok.ADMIN).post(`/students/guardians/${guardianId}/login`, { username: uname('omar.dad2') })).status).toBe(409);

    const user = await basePrisma.user.findUniqueOrThrow({ where: { id: made.body.data.user.id } });
    const P = as(tokenFor(user));
    expect((await P.get('/family/children')).body.data.map((k: { name: string }) => k.name)).toEqual(['Omar Student']);
    expect((await P.get(`/fees/students/${ids.omar}`)).status).toBe(200);
    expect((await P.get(`/fees/students/${ids.zara}`)).status).toBe(404);
    // The school switches fees off for parents.
    const parent = granted(await role('PARENT'));
    await as(tok.OWNER).put('/roles/PARENT', { permissions: parent.filter((p) => p !== 'fee.view' && p !== 'fee.pay') });
    expect((await P.get(`/fees/students/${ids.omar}`)).status).toBe(403);
    expect((await P.get(`/family/home?studentId=${ids.omar}`)).status).toBe(200);
  });

  it('the owner can’t be locked out, and reset restores the standard set', async () => {
    const O = as(tok.OWNER);
    expect((await O.put('/roles/ADMIN', { permissions: [], creates: [] })).status).toBe(200);
    expect((await as(tok.ADMIN).get('/students')).status).toBe(403);
    expect((await as(tok.ADMIN).get('/notices')).status).toBe(200); // everyone still reads notices
    expect((await O.get('/roles')).status).toBe(200);

    for (const r of ['ADMIN', 'PRINCIPAL', 'ACCOUNTANT', 'PARENT', 'STUDENT']) expect((await O.post(`/roles/${r}/reset`)).status).toBe(200);
    expect((await role('ADMIN')).changed).toBe(0);
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);
    expect((await as(tok.ADMIN).get('/users')).status).toBe(200);
    expect((await as(tok.ACCOUNTANT).get('/users')).status).toBe(403);
    expect((await as(tok.PRINCIPAL).get('/auth/me')).body.data.creatableRoles).toEqual(['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);
  });
});
