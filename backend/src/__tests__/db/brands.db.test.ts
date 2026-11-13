import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { connectRedis } from '../../config/redis';
jest.setTimeout(120_000);
import { basePrisma } from '../../config/database';
import { createTestSchool, tokenFor } from './helpers';
import { forgetLicence } from '../../utils/licence';
import { verifyToken } from '../../utils/jwt';

const suite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
suite('Brand tenancy, switching and shared licensing', () => {
  let a: Awaited<ReturnType<typeof createTestSchool>>;
  let b: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  let brandId: string;
  let owner: any, admin: any, superUser: any;
  const as = (token: string) => ({
    get: (path: string) => request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: any) => request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body),
    patch: (path: string, body: any) => request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body),
    put: (path: string, body: any) => request(app).put(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body),
    del: (path: string) => request(app).delete(`/api/v1${path}`).auth(token, { type: 'bearer' }),
  });
  beforeAll(async () => {
    await connectRedis();
    a = await createTestSchool('brand-main'); b = await createTestSchool('brand-north'); other = await createTestSchool('brand-other');
    const brand = await basePrisma.brand.create({ data: { name: 'Test Brand', code: a.code, maxBranches: 2, maxStudents: 2 } }); brandId = brand.id;
    await basePrisma.school.updateMany({ where: { id: { in: [a.school.id, b.school.id] } }, data: { brandId } });
    owner = await a.user('OWNER'); admin = await a.user('ADMIN'); superUser = await other.user('SUPER_ADMIN');
    await basePrisma.brandOwner.create({ data: { brandId, userId: owner.id } });
  });
  afterAll(async () => {
    await a?.destroy(); await b?.destroy(); await other?.destroy();
    if (brandId) await basePrisma.brand.delete({ where: { id: brandId } });
  });
  it('platform creates a brand and first owner, then serializes concurrent branch creation', async () => {
    const code = `new-brand-${Date.now()}`;
    const made = await as(superUser.token).post('/brands', {
      name: 'New School Brand', code, owner: { name: 'New Owner', email: `${code}@test.local`, password: 'Initial@123' },
      licence: { maxBranches: 2, maxStudents: 50 },
      branch: { name: 'Main', code: `${code}-main`, academicYear: { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' } },
    });
    expect(made.status).toBe(201);
    const id = made.body.data.id;
    try {
      expect(made.body.data.owners).toHaveLength(1);
      const body = (suffix: string) => ({ name: suffix, code: `${code}-${suffix}`, academicYear: { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' } });
      const results = await Promise.all([as(superUser.token).post(`/brands/${id}/branches`, body('north')), as(superUser.token).post(`/brands/${id}/branches`, body('south'))]);
      expect(results.map(r => r.status).sort()).toEqual([201, 409]);
      expect((await as(superUser.token).get(`/brands/${id}`)).body.data.branches).toHaveLength(2);
    } finally {
      const ids = (await basePrisma.school.findMany({ where: { brandId: id }, select: { id: true } })).map(b => b.id);
      await basePrisma.designation.deleteMany({ where: { schoolId: { in: ids } } });
      await basePrisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
      await basePrisma.user.deleteMany({ where: { schoolId: { in: ids } } });
      await basePrisma.school.deleteMany({ where: { brandId: id } });
      await basePrisma.brand.delete({ where: { id } });
    }
  });
  it('owner sees their brand branches, never another brand', async () => {
    const me = await as(owner.token).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.branches.map((s: any) => s.id).sort()).toEqual([a.school.id, b.school.id].sort());
    expect((await as(admin.token).get('/auth/me')).body.data.branches.map((s: any) => s.id)).toEqual([a.school.id]);
    expect((await as(owner.token).get('/brands')).body.data.map((s: any) => s.id)).toEqual([brandId]);
    expect((await as(admin.token).get('/brands')).status).toBe(403);
  });
  it('rejects switching outside ownership and forged target-branch tokens', async () => {
    expect((await as(owner.token).post('/auth/switch-branch', { schoolId: other.school.id })).status).toBe(403);
    expect((await as(admin.token).post('/auth/switch-branch', { schoolId: b.school.id })).status).toBe(403);
    const forged = tokenFor({ ...admin, schoolId: b.school.id });
    expect((await as(forged).get('/students')).status).toBe(403);
  });
  it('owner switches branch and refresh stays in the selected branch', async () => {
    const switched = await as(owner.token).post('/auth/switch-branch', { schoolId: b.school.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.user.school.id).toBe(b.school.id);
    expect(switched.body.data.user.role).toBe('OWNER');
    expect(verifyToken(switched.body.data.accessToken).schoolId).toBe(b.school.id);
    const renewed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: switched.body.data.refreshToken });
    expect(renewed.status).toBe(200);
    expect(verifyToken(renewed.body.data.accessToken).schoolId).toBe(b.school.id);
    expect((await as(switched.body.data.accessToken).get('/auth/me')).body.data.school.id).toBe(b.school.id);
    expect((await as(owner.token).get('/students')).status).toBe(401);
    owner.token = switched.body.data.accessToken;
  });
  it('branch creation is platform-only and counts suspended branches against the licence', async () => {
    const body = { name: 'Third branch', code: `${a.code}-third`, academicYear: { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' } };
    expect((await as(owner.token).post(`/brands/${brandId}/branches`, body)).status).toBe(403);
    await basePrisma.school.update({ where: { id: a.school.id }, data: { isActive: false } });
    expect((await as(superUser.token).post(`/brands/${brandId}/branches`, body)).status).toBe(409);
    await basePrisma.school.update({ where: { id: a.school.id }, data: { isActive: true } });
  });
  it('staff access uses the role of the selected branch and is revoked immediately', async () => {
    const add = await as(owner.token).put(`/brands/${brandId}/access`, { schoolId: b.school.id, userId: admin.id, role: 'TEACHER' });
    expect(add.status).toBe(200);
    const login = await request(app).post('/api/v1/auth/login').send({ email: admin.email, password: 'Test@12345' });
    expect(login.status).toBe(200);
    const switched = await as(login.body.data.accessToken).post('/auth/switch-branch', { schoolId: b.school.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.user.role).toBe('TEACHER');
    expect((await as(switched.body.data.accessToken).post('/academics/classes', { name: 'No', level: 1 })).status).toBe(403);
    const access = await basePrisma.branchAccess.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: b.school.id, userId: admin.id } } });
    expect((await as(owner.token).del(`/brands/${brandId}/access/${access.id}`)).status).toBe(200);
    expect([401, 403]).toContain((await as(switched.body.data.accessToken).get('/students')).status);
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: switched.body.data.refreshToken });
    expect(refreshed.status).toBe(401);
  });
  it('shared staff profiles retain self-salary and bank-detail protections', async () => {
    const staff = await basePrisma.staff.create({ data: { schoolId: b.school.id, employeeNo: 'SHARED-1', name: 'Shared Admin', isTeacher: false } });
    expect((await as(owner.token).put(`/brands/${brandId}/access`, { schoolId: b.school.id, userId: admin.id, role: 'ADMIN', staffId: staff.id })).status).toBe(200);
    const login = await request(app).post('/api/v1/auth/login').send({ email: admin.email, password: 'Test@12345' });
    const switched = await as(login.body.data.accessToken).post('/auth/switch-branch', { schoolId: b.school.id });
    expect(switched.status).toBe(200);
    const shared = as(switched.body.data.accessToken);
    expect((await shared.get('/hr/me')).body.data.staff.id).toBe(staff.id);
    expect((await shared.post(`/hr/staff/${staff.id}/salary`, { effectiveFrom: '2026-11-01', basic: 5000, components: [] })).status).toBe(403);
    expect((await shared.patch(`/staff/${staff.id}`, { bankName: 'Own new bank' })).status).toBe(403);
    expect((await shared.post(`/staff/${staff.id}/status`, { status: 'INACTIVE' })).status).toBe(403);
    const access = await basePrisma.branchAccess.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: b.school.id, userId: admin.id } } });
    expect((await as(owner.token).del(`/brands/${brandId}/access/${access.id}`)).status).toBe(200);
  });
  it('cannot grant staff access to another brand or assign a foreign custom role', async () => {
    expect((await as(owner.token).put(`/brands/${brandId}/access`, { schoolId: other.school.id, userId: admin.id, role: 'ADMIN' })).status).toBe(404);
    const role = await basePrisma.customRole.create({ data: { schoolId: other.school.id, name: 'Foreign', baseRole: 'ADMIN', permissions: [] } });
    expect((await as(owner.token).put(`/brands/${brandId}/access`, { schoolId: b.school.id, userId: admin.id, role: 'ADMIN', customRoleId: role.id })).status).toBe(422);
  });
  it('one brand expiry locks every branch and renewal unlocks both', async () => {
    const expired = await as(superUser.token).patch(`/brands/${brandId}/licence`, { paidUntil: '2020-01-01', graceDays: 0 });
    expect(expired.status).toBe(200);
    expect((await as(owner.token).get('/students')).status).toBe(402);
    const mainOwner = tokenFor({ ...owner, schoolId: a.school.id });
    expect((await as(mainOwner).get('/students')).status).toBe(402);
    const view = await as(owner.token).get('/licence');
    expect(view.status).toBe(200); expect(view.body.data.brand.id).toBe(brandId);
    expect(view.body.data.maxBranches).toBe(2);
    const renewal = await as(superUser.token).post(`/brands/${brandId}/licence/payments`, { amount: 1000, paidOn: '2026-01-01', paidUntil: '2030-01-01' });
    expect(renewal.status).toBe(201);
    expect((await as(owner.token).get('/students')).status).toBe(200);
    expect((await as(mainOwner).get('/students')).status).toBe(200);
    const paymentId = renewal.body.data.payments[0].id;
    expect((await as(superUser.token).del(`/brands/${brandId}/licence/payments/${paymentId}`)).status).toBe(200);
    expect((await as(owner.token).get('/students')).status).toBe(402);
    expect((await as(superUser.token).post(`/brands/${brandId}/licence/payments`, { amount: 1000, paidOn: '2026-01-01', paidUntil: '2030-01-01' })).status).toBe(201);
  });
  it('enforces student capacity separately per branch, including concurrent admissions and reactivation', async () => {
    await basePrisma.brand.update({ where: { id: brandId }, data: { maxStudents: 1 } }); forgetLicence(brandId);
    const current = as(owner.token);
    const cls = await current.post('/academics/classes', { name: 'Class 1', level: 1, sections: ['A'] });
    expect(cls.status).toBe(201);
    const sectionId = cls.body.data.sections[0].id;
    const admit = (name: string) => current.post('/students', { admissionNo: name, name, sectionId, guardians: [{ name: 'Parent', phone: '03001234567', relation: 'FATHER', isPrimary: true }] });
    const results = await Promise.all([admit('One'), admit('Two')]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const existing = results.find(r => r.status === 201)!.body.data.student;
    expect((await current.post(`/students/${existing.id}/status`, { status: 'LEFT' })).status).toBe(200);
    expect((await admit('Three')).status).toBe(201);
    expect((await current.post(`/students/${existing.id}/status`, { status: 'ACTIVE' })).status).toBe(409);
    const mainOwner = tokenFor({ ...owner, schoolId: a.school.id });
    const mainClass = await as(mainOwner).post('/academics/classes', { name: 'Class 1', level: 1, sections: ['A'] });
    expect((await as(mainOwner).post('/students', { admissionNo: 'Main-1', name: 'Main Student', sectionId: mainClass.body.data.sections[0].id, guardians: [{ name: 'Parent', phone: '03001111111', relation: 'FATHER', isPrimary: true }] })).status).toBe(201);
  });
  it('consolidated reports include only this brand and legacy APIs cannot alter branch licensing', async () => {
    const res = await as(owner.token).get(`/brands/${brandId}/summary`);
    expect(res.status).toBe(200); expect(res.body.data.branches).toHaveLength(2);
    expect(res.body.data.branches.map((s: any) => s.id)).not.toContain(other.school.id);
    expect((await as(superUser.token).patch(`/platform/schools/${b.school.id}/licence`, { maxStudents: 999 })).status).toBe(409);
  });
});
