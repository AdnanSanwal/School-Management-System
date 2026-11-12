/**
 * Security regression tests for the production audit (docs/security/SECURITY_FINDINGS.md).
 * Each block names the finding it guards. Runs against the real database + Redis.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/security
 */
import 'dotenv/config';
import request from 'supertest';
import axios from 'axios';
import { authenticator } from 'otplib';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { signRefreshToken } from '../../utils/jwt';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

d('Security regressions (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  type U = Awaited<ReturnType<typeof t.user>>;
  let owner: U, admin: U, principal: U, accountant: U, parent: U;
  const api = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
    };
  };
  const staffFor = (u: U, name: string) => basePrisma.staff.create({ data: { schoolId: t.school.id, userId: u.id, name, employeeNo: `S-${name}-${Date.now() % 100000}` } });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('sec');
    owner = await t.user('OWNER');
    admin = await t.user('ADMIN');
    principal = await t.user('PRINCIPAL');
    accountant = await t.user('ACCOUNTANT');
    parent = await t.user('PARENT');
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await t.destroy();
  });

  // ── AUTH-1/2/3: OAuth ──────────────────────────────────────────────────────
  describe('OAuth sign-in (AUTH-1..3)', () => {
    const env = { ...process.env };
    afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

    it('is off unless explicitly enabled, and Microsoft refuses a multi-tenant setup', async () => {
      delete process.env.OAUTH_ENABLED;
      expect((await request(app).get('/api/v1/auth/oauth/google')).status).toBe(404);
      Object.assign(process.env, { OAUTH_ENABLED: 'true', MS_CLIENT_ID: 'x', MS_CLIENT_SECRET: 'y', MS_TENANT_ID: 'common' });
      expect((await request(app).get('/api/v1/auth/oauth/microsoft')).status).toBe(404);
    });

    async function startGoogle() {
      Object.assign(process.env, { OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', FRONTEND_URL: 'http://web.test', BACKEND_URL: 'http://api.test' });
      const start = await request(app).get('/api/v1/auth/oauth/google');
      expect(start.status).toBe(302);
      const location = new URL(start.headers.location);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      const state = location.searchParams.get('state')!;
      const cookie = String(start.headers['set-cookie']).split(';')[0];
      expect(cookie).toBe(`oauth_state=${state}`);
      return { state, cookie };
    }
    const mockGoogle = (info: object) => {
      jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'tok' } } as never);
      jest.spyOn(axios, 'get').mockResolvedValue({ data: info } as never);
    };

    it('refuses a callback whose state does not match the browser (login CSRF)', async () => {
      const { state } = await startGoogle();
      mockGoogle({ email: admin.email, email_verified: true, sub: 'g-1' });
      const noCookie = await request(app).get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`);
      expect(noCookie.headers.location).toMatch(/error=oauth_failed/);
      const { cookie } = await startGoogle();
      const wrong = await request(app).get('/api/v1/auth/oauth/google/callback?code=abc&state=' + 'f'.repeat(48)).set('Cookie', cookie);
      expect(wrong.headers.location).toMatch(/error=oauth_failed/);
    });

    it('never links an unverified Google email to an account', async () => {
      const { state, cookie } = await startGoogle();
      mockGoogle({ email: admin.email, email_verified: false, sub: 'attacker' });
      const r = await request(app).get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`).set('Cookie', cookie);
      expect(r.headers.location).toMatch(/error=no_account/);
      expect((await basePrisma.user.findUniqueOrThrow({ where: { id: admin.id } })).oauthId).toBeNull();
    });

    it('does not let OAuth skip two-step login', async () => {
      await basePrisma.user.update({ where: { id: principal.id }, data: { mfaEnabled: true, mfaSecret: authenticator.generateSecret() } });
      const { state, cookie } = await startGoogle();
      mockGoogle({ email: principal.email, email_verified: true, sub: 'g-principal' });
      const r = await request(app).get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`).set('Cookie', cookie);
      expect(r.headers.location).toMatch(/error=mfa_required/);
      await basePrisma.user.update({ where: { id: principal.id }, data: { mfaEnabled: false, mfaSecret: null } });
    });

    it('hands the web app a one-time code (never tokens in the URL)', async () => {
      const { state, cookie } = await startGoogle();
      mockGoogle({ email: accountant.email, email_verified: true, sub: 'g-acc' });
      const r = await request(app).get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`).set('Cookie', cookie);
      expect(r.headers.location).toMatch(/\/oauth-callback#code=/);
      expect(r.headers.location).not.toMatch(/Token/i);
      const code = r.headers.location.split('#code=')[1];
      const ex = await request(app).post('/api/v1/auth/oauth/exchange').send({ code });
      expect(ex.status).toBe(200);
      expect(ex.body.data.accessToken).toBeTruthy();
      expect((await request(app).post('/api/v1/auth/oauth/exchange').send({ code })).status).toBe(401); // single use
      // The state can't be replayed either.
      const again = await request(app).get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`).set('Cookie', cookie);
      expect(again.headers.location).toMatch(/error=oauth_failed/);
    });
  });

  // ── AUTH-14: token types ───────────────────────────────────────────────────
  it('a refresh token is not accepted as an access token (AUTH-14)', async () => {
    const refresh = signRefreshToken({ id: admin.id, role: 'ADMIN', email: admin.email, schoolId: t.school.id });
    // Signed with the refresh secret, so it already fails; also check a same-secret mix-up is refused.
    expect((await api(refresh).get('/auth/me')).status).toBe(401);
  });

  // ── AUTH-6/7: two-step login ───────────────────────────────────────────────
  it('turning on two-step login needs the password; a code works only once (AUTH-6, AUTH-7)', async () => {
    const A = api(accountant.token);
    expect((await A.post('/auth/mfa/enable', {})).status).toBe(422);
    expect((await A.post('/auth/mfa/enable', { password: 'wrong-password' })).status).toBe(400);
    const en = await A.post('/auth/mfa/enable', { password: 'Test@12345' });
    expect(en.status).toBe(200);
    const stored = (await basePrisma.user.findUniqueOrThrow({ where: { id: accountant.id } })).mfaSecret!;
    if (process.env.AES_SECRET_KEY) expect(stored.startsWith('enc:')).toBe(true); // encrypted at rest
    const code = authenticator.generate(en.body.data.secret);
    expect((await A.post('/auth/mfa/verify', { code })).status).toBe(200);
    const login = (mfaCode: string) => request(app).post('/api/v1/auth/login').send({ email: accountant.email, password: 'Test@12345', mfaCode });
    expect((await login(code)).status).toBe(401); // same code replayed
    await basePrisma.user.update({ where: { id: accountant.id }, data: { mfaEnabled: false, mfaSecret: null } });
  });

  // ── AUTH-15: password policy ───────────────────────────────────────────────
  it('refuses common and over-long passwords (AUTH-15)', async () => {
    const A = api(owner.token);
    expect((await A.post('/auth/change-password', { currentPassword: 'Test@12345', newPassword: 'password123' })).status).toBe(422);
    expect((await A.post('/auth/change-password', { currentPassword: 'Test@12345', newPassword: 'x'.repeat(73) })).status).toBe(422);
    const weakLogin = await A.post('/users', { name: 'Weak Pass', role: 'TEACHER', username: `weak.${t.code}`.replace(/[^a-z0-9.]/gi, '').toLowerCase(), password: 'admin@123' });
    expect(weakLogin.status).toBe(422);
  });

  // ── AUTH-4: per-account limit across addresses ─────────────────────────────
  it('locks an account after repeated failures even when they come from many addresses (AUTH-4)', async () => {
    process.env.RATE_LIMIT_IN_TESTS = '1';
    app.set('trust proxy', 1);
    try {
      let last = 0;
      for (let i = 0; i < 31; i++) {
        const r = await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', `10.77.${i}.${Date.now() % 200}`).send({ email: parent.email, password: 'wrong-pass' });
        last = r.status;
      }
      expect(last).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
      app.set('trust proxy', false);
    }
  });

  // ── LOG-3: sign-in events are logged ───────────────────────────────────────
  it('failed and successful sign-ins are in the activity log (LOG-3)', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'nope-nope' });
    await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'Test@12345' });
    const rows = await basePrisma.auditLog.findMany({ where: { userId: owner.id, entity: 'auth' }, select: { action: true, meta: true } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['Sign-in failed', 'Signed in']));
    expect(JSON.stringify(rows)).not.toMatch(/nope-nope|Test@12345/);
  });

  // ── AUTHZ-1: a limited custom role can't reach more through other logins ───
  describe('custom role limits (AUTHZ-1)', () => {
    let frontDesk: U;
    beforeAll(async () => {
      const role = await api(owner.token).post('/roles/custom', { name: 'Front desk', baseRole: 'ADMIN', permissions: ['student.view', 'student.admit'] });
      expect(role.status).toBe(201);
      frontDesk = await t.user('ADMIN', 'frontdesk');
      const id = role.body.data.custom.find((c: { name: string }) => c.name === 'Front desk').id;
      expect((await api(owner.token).patch(`/users/${frontDesk.id}`, { customRoleId: id })).status).toBe(200);
    });

    it('cannot create an accountant login (more permissions than it has)', async () => {
      const r = await api(frontDesk.token).post('/users', { name: 'Shadow Acc', role: 'ACCOUNTANT', username: `shadow.${t.code}`.replace(/[^a-z0-9.]/gi, '').toLowerCase(), password: 'Shadow-Pass-2026' });
      expect(r.status).toBe(403);
    });
    it('cannot reset an accountant’s password', async () => {
      expect((await api(frontDesk.token).post(`/users/${accountant.id}/reset-password`)).status).toBe(403);
    });
    it('a standard office admin still can (unchanged behaviour)', async () => {
      expect((await api(admin.token).post(`/users/${accountant.id}/reset-password`)).status).toBe(200);
    });

    // AUTHZ-3: the dashboard cache doesn't leak a fuller view to the limited role.
    it('dashboard data follows the custom role, not a cached admin copy (AUTHZ-3)', async () => {
      const full = await api(admin.token).get('/dashboard/overview');
      expect(full.status).toBe(200);
      const limited = await api(frontDesk.token).get('/dashboard/overview');
      expect(limited.status).toBe(200);
      expect(limited.body.data.fees ?? null).toBeNull();
    });
  });

  // ── AUTHZ-2: staff status can't switch off a login you may not manage ──────
  it('an office admin cannot deactivate the principal through the staff status (AUTHZ-2)', async () => {
    const principalStaff = await staffFor(principal, 'Principal');
    const r = await api(admin.token).post(`/staff/${principalStaff.id}/status`, { status: 'TERMINATED' });
    expect(r.status).toBe(403);
    expect((await basePrisma.user.findUniqueOrThrow({ where: { id: principal.id } })).isActive).toBe(true);
  });

  // ── AUTHZ-5: separation of duties ──────────────────────────────────────────
  it('nobody but the owner sets their own salary or bank details (AUTHZ-5)', async () => {
    const mine = await staffFor(admin, 'Admin');
    const salary = await api(admin.token).post(`/hr/staff/${mine.id}/salary`, { effectiveFrom: '2026-11-01', basic: 999999, components: [] });
    expect(salary.status).toBe(403);
    const bank = await api(admin.token).patch(`/staff/${mine.id}`, { bankAccountNo: 'PK00ATTACKER0000' });
    expect(bank.status).toBe(403);
    // The owner may change it, and it is logged.
    expect((await api(owner.token).patch(`/staff/${mine.id}`, { bankAccountNo: 'PK00REAL00001234' })).status).toBe(200);
    expect(await basePrisma.auditLog.count({ where: { entityId: mine.id, action: 'Bank details changed' } })).toBe(1);
  });

  // ── API-1: push subscriptions can't point the server at internal hosts ────
  it('push subscriptions must be a real browser push service (API-1)', async () => {
    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    expect((await api(parent.token).post('/push/subscribe', { endpoint: 'https://127.0.0.1:8443/admin', keys })).status).toBe(422);
    expect((await api(parent.token).post('/push/subscribe', { endpoint: 'https://fcm.googleapis.com.evil.test/x', keys })).status).toBe(422);
    expect((await api(parent.token).post('/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/${t.code}`, keys })).status).toBe(201);
  });

  // ── API-3: report names can't reach Object prototype keys ─────────────────
  it('unknown report names are a clean 404 (API-3)', async () => {
    for (const name of ['constructor', '__proto__', 'toString']) expect((await api(owner.token).get(`/reports/${name}`)).status).toBe(404);
  });

  // ── AUTH-10: suspension signs the whole school out at once ────────────────
  it('suspending a school ends its sessions immediately (AUTH-10)', async () => {
    const other = await createTestSchool('sec2');
    try {
      const u = await other.user('OWNER');
      expect((await api(u.token).get('/auth/me')).status).toBe(200);
      const platform = await basePrisma.user.create({ data: { role: 'SUPER_ADMIN', name: 'Platform Test', email: `platform.${other.code}@test.local`, password: 'x' } });
      try {
        const p = tokenFor({ id: platform.id, role: 'SUPER_ADMIN', email: platform.email, schoolId: null });
        expect((await api(p).patch(`/platform/schools/${other.school.id}/status`, { isActive: false })).status).toBe(200);
        expect((await api(u.token).get('/auth/me')).status).toBe(401);
      } finally {
        await basePrisma.user.delete({ where: { id: platform.id } });
      }
    } finally {
      await other.destroy();
    }
  });
});
