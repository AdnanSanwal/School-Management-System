/**
 * Production hardening against the real database + Redis: brute-force limits, one session
 * per device, "sign out everywhere", readiness probe, audit trail.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/hardening
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

d('Production hardening (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let owner: Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>;
  let accountant: typeof owner;
  const login = (email: string, password = 'Test@12345', ip = '10.9.8.7') =>
    request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  const refresh = (refreshToken: string) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });
  const me = (token: string) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('hard');
    owner = await t.user('OWNER');
    accountant = await t.user('ACCOUNTANT');
  });
  afterAll(async () => { await t.destroy(); });

  it('locks an account out after 10 failed sign-ins (per account, not the whole network)', async () => {
    process.env.RATE_LIMIT_IN_TESTS = '1';
    app.set('trust proxy', 1);
    try {
      const ip = `10.0.${Date.now() % 250}.1`;
      for (let i = 0; i < 10; i++) expect((await login(accountant.email, 'wrong-pass', ip)).status).toBe(401);
      const locked = await login(accountant.email, 'Test@12345', ip);
      expect(locked.status).toBe(429);
      expect(locked.body.message).toMatch(/Too many failed sign-ins/);
      // Another account from the same office network still works.
      expect((await login(owner.email, 'Test@12345', ip)).status).toBe(200);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
      app.set('trust proxy', false);
    }
  });

  it('each device has its own session: signing out one leaves the other signed in', async () => {
    const web = (await login(owner.email)).body.data;
    const phone = (await login(owner.email)).body.data;
    expect((await refresh(web.refreshToken)).status).toBe(200);
    expect((await refresh(phone.refreshToken)).status).toBe(200);

    expect((await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${web.accessToken}`)).status).toBe(200);
    expect((await me(web.accessToken)).status).toBe(401);
    expect((await refresh(web.refreshToken)).status).toBe(401);
    expect((await me(phone.accessToken)).status).toBe(200);
    expect((await refresh(phone.refreshToken)).status).toBe(200);
  });

  it('changing the password ends the other devices but keeps this one', async () => {
    const a = (await login(accountant.email)).body.data;
    const b = (await login(accountant.email)).body.data;
    const res = await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${a.accessToken}`)
      .send({ currentPassword: 'Test@12345', newPassword: 'NewPass@2026' });
    expect(res.status).toBe(200);
    expect((await refresh(a.refreshToken)).status).toBe(200);
    expect((await refresh(b.refreshToken)).status).toBe(401);
    await basePrisma.user.update({ where: { id: accountant.id }, data: { password: (await basePrisma.user.findUniqueOrThrow({ where: { id: owner.id } })).password } });
  });

  it('deactivating a user cuts their open sessions off immediately', async () => {
    const s = (await login(accountant.email)).body.data;
    expect((await me(s.accessToken)).status).toBe(200);
    const off = await request(app).patch(`/api/v1/users/${accountant.id}`).set('Authorization', `Bearer ${owner.token}`).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await me(s.accessToken)).status).toBe(401);
    expect((await refresh(s.refreshToken)).status).toBe(401);
    await basePrisma.user.update({ where: { id: accountant.id }, data: { isActive: true } });
  });

  it('readiness reports the database and Redis', async () => {
    const r = await request(app).get('/ready');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, draining: false, checks: { database: { ok: true }, redis: { ok: true } } });
  });

  it('every change lands in the audit trail; owners can read it, others cannot', async () => {
    const res = await request(app).post('/api/v1/academics/classes').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Audit Class', level: 3, sections: ['A'] });
    // Owners can't manage classes; use the principal for a successful change.
    const principal = await t.user('PRINCIPAL');
    const ok = res.status < 400 ? res : await request(app).post('/api/v1/academics/classes').set('Authorization', `Bearer ${principal.token}`).send({ name: 'Audit Class', level: 3, sections: ['A'] });
    expect(ok.status).toBeLessThan(400);
    await new Promise((r) => setTimeout(r, 300)); // written after the response
    const rows = await basePrisma.auditLog.findMany({ where: { schoolId: t.school.id, action: 'POST /academics/classes' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ entity: 'academics', userId: principal.id });
    expect(JSON.stringify(rows[0].meta)).not.toMatch(/Audit Class/); // never the request body

    const list = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: any) => r.action === 'POST /academics/classes' && r.user?.id === principal.id)).toBe(true);
    // (The accountant above was deactivated, which rightly voided their old tokens: use a fresh one.)
    const teacher = await t.user('TEACHER', 'auditteacher');
    expect((await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${teacher.token}`)).status).toBe(403);
  });
});
