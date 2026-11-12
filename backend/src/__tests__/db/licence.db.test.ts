/**
 * Licensing: each school's subscription (set by the platform admin), the notice / grace /
 * lock states, payments, and the student limit.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/licence
 */
import 'dotenv/config';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { addDays, dayInTimezone, toDate, toIso } from '../../utils/dates';
import { evaluateLicence } from '../../utils/licence';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('evaluateLicence', () => {
  const on = (paidUntil: string | null, extra: object = {}) =>
    evaluateLicence({ licencePaidUntil: paidUntil ? new Date(`${paidUntil}T00:00:00Z`) : null, licenceGraceDays: 7, licenceNotifyDays: 10, licenceOverride: false, licencePlan: 'Standard', licenceMessage: null, maxStudents: null, ...extra }, '2026-11-12');

  it('no end date means active', () => expect(on(null)).toMatchObject({ state: 'ACTIVE', paidUntil: null, daysLeft: null, lockDate: null }));
  it('is active while the end date is beyond the notice period', () => expect(on('2026-12-31')).toMatchObject({ state: 'ACTIVE', daysLeft: 49, lockDate: '2027-01-08' }));
  it('warns inside the notice period, through the last paid day', () => {
    expect(on('2026-11-22')).toMatchObject({ state: 'DUE_SOON', daysLeft: 10 });
    expect(on('2026-11-23').state).toBe('ACTIVE');
    expect(on('2026-11-12')).toMatchObject({ state: 'DUE_SOON', daysLeft: 0, summary: 'The subscription ends today' });
  });
  it('keeps working for the grace days, then locks', () => {
    expect(on('2026-11-11')).toMatchObject({ state: 'GRACE', daysLeft: -1, lockDate: '2026-11-19' });
    expect(on('2026-11-05').state).toBe('GRACE');   // 7 days late: last grace day
    expect(on('2026-11-04')).toMatchObject({ state: 'LOCKED', daysLeft: -8 });
    expect(on('2026-11-11', { licenceGraceDays: 0 }).state).toBe('LOCKED');
  });
  it('the provider can keep a school on regardless of the date', () => expect(on('2026-01-01', { licenceOverride: true })).toMatchObject({ state: 'ACTIVE', lockDate: null }));
  it('a missing school record never locks anyone', () => expect(evaluateLicence(null, '2026-11-12').state).toBe('ACTIVE'));
});

d('Licensing (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  let superId = '';
  const today = dayInTimezone('Asia/Karachi');
  const day = (n: number) => toIso(addDays(toDate(today), n));
  const as = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    };
  };
  const set = (b: object) => as(tok.SUPER).patch(`/platform/schools/${t.school.id}/licence`, b);
  const state = async (role = 'OWNER') => (await as(tok[role]).get('/auth/me')).body.data.licence.state;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('lic');
    other = await createTestSchool('lic2');
    for (const r of ['OWNER', 'ADMIN', 'TEACHER'] as const) tok[r] = (await t.user(r)).token;
    tok.otherAdmin = (await other.user('ADMIN')).token;
    const su = await basePrisma.user.create({ data: { role: 'SUPER_ADMIN', name: 'Platform', email: `super.${t.code}@test.local`, password: await bcrypt.hash('Test@12345', 4) } });
    superId = su.id;
    tok.SUPER = tokenFor(su);
  });
  afterAll(async () => {
    await basePrisma.user.delete({ where: { id: superId } });
    await t.destroy(); await other.destroy();
  });

  it('a new school is active with no end date; only the platform sets subscriptions', async () => {
    expect(await state()).toBe('ACTIVE');
    const mine = (await as(tok.OWNER).get('/licence')).body.data;
    expect(mine).toMatchObject({ status: { state: 'ACTIVE', paidUntil: null }, payments: [], activeStudents: 0 });
    expect((await as(tok.TEACHER).get('/licence')).body.data).toEqual({ status: expect.objectContaining({ state: 'ACTIVE' }) });
    expect((await as(tok.OWNER).patch(`/platform/schools/${t.school.id}/licence`, { paidUntil: day(999) })).status).toBe(403);
    expect((await set({ paidUntil: 'soon' })).status).toBe(422);
    expect((await as(tok.SUPER).patch('/platform/schools/00000000-0000-0000-0000-000000000000/licence', { plan: 'x' })).status).toBe(404);
  });

  it('notice period, then grace: the school keeps working and is told', async () => {
    expect((await set({ plan: 'Standard', paidUntil: day(5), notifyDays: 10, graceDays: 7, message: 'Thank you for your business' })).status).toBe(200);
    const me = (await as(tok.OWNER).get('/auth/me')).body.data.licence;
    expect(me).toMatchObject({ state: 'DUE_SOON', plan: 'Standard', paidUntil: day(5), daysLeft: 5, lockDate: day(13), message: 'Thank you for your business' });
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);

    await set({ paidUntil: day(-3) });
    expect(await state()).toBe('GRACE');
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);
    const listed = (await as(tok.SUPER).get('/platform/schools')).body.data.find((s: { id: string }) => s.id === t.school.id);
    expect(listed.licence).toMatchObject({ state: 'GRACE', daysLeft: -3 });
  });

  it('after the grace days the school is locked: it can sign in and see why, nothing else', async () => {
    await set({ paidUntil: day(-30) });
    for (const role of ['OWNER', 'ADMIN', 'TEACHER']) {
      const res = await as(tok[role]).get(role === 'TEACHER' ? '/notices' : '/students');
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({ success: false, code: 'LICENCE_LOCKED', licence: { state: 'LOCKED', paidUntil: day(-30) } });
    }
    expect((await as(tok.OWNER).post('/finance/income', {})).status).toBe(402);
    // Still reachable: who am I, and the subscription page.
    expect(await state()).toBe('LOCKED');
    expect((await as(tok.OWNER).get('/licence')).body.data.status.summary).toMatch(/locked until it is renewed/);
    // Other schools and the platform are not affected.
    expect((await as(tok.otherAdmin).get('/students')).status).toBe(200);
    expect((await as(tok.SUPER).get('/platform/schools')).status).toBe(200);
  });

  it('a payment moves the paid-until date and unlocks at once; a mistaken one can be undone', async () => {
    const S = as(tok.SUPER);
    const url = `/platform/schools/${t.school.id}/licence/payments`;
    expect((await S.post(url, { amount: 5000, paidOn: today, paidUntil: day(-40) })).status).toBe(422); // before the payment date
    expect((await S.post(url, { amount: 0, paidOn: today, paidUntil: day(30) })).status).toBe(422);
    expect((await as(tok.OWNER).post(url, { amount: 5000, paidOn: today, paidUntil: day(30) })).status).toBe(402); // locked comes first

    const paid = await S.post(url, { amount: 5000, paidOn: today, paidUntil: day(30), method: 'Bank transfer', reference: 'TXN-9' });
    expect(paid.status).toBe(201);
    expect(paid.body.data.status).toMatchObject({ state: 'ACTIVE', paidUntil: day(30) });
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);
    const mine = (await as(tok.OWNER).get('/licence')).body.data;
    expect(mine.payments).toEqual([expect.objectContaining({ paidOn: today, coversUntil: day(30), method: 'Bank transfer', reference: 'TXN-9' })]);
    expect(Number(mine.payments[0].amount)).toBe(5000);

    // The next payment must extend further.
    expect((await S.post(url, { amount: 5000, paidOn: today, paidUntil: day(30) })).status).toBe(422);
    const second = await S.post(url, { amount: 5000, paidOn: today, paidUntil: day(60) });
    const [latest, first] = second.body.data.payments;
    expect([latest.removable, first.removable]).toEqual([true, false]);
    expect((await S.del(`${url}/${first.id}`)).status).toBe(409);
    expect((await S.del(`${url}/${latest.id}`)).body.data.status.paidUntil).toBe(day(30));
    // Undoing the first one too puts the school back where it was: locked.
    expect((await S.del(`${url}/${first.id}`)).body.data.status).toMatchObject({ state: 'LOCKED', paidUntil: day(-30) });
    expect((await as(tok.ADMIN).get('/students')).status).toBe(402);
  });

  it('the provider can keep a school on, and clear the end date', async () => {
    expect((await set({ override: true })).body.data.status.state).toBe('ACTIVE');
    expect((await as(tok.ADMIN).get('/students')).status).toBe(200);
    await set({ override: false });
    expect((await as(tok.ADMIN).get('/students')).status).toBe(402);
    expect((await set({ paidUntil: null })).body.data.status).toMatchObject({ state: 'ACTIVE', paidUntil: null });
  });

  it('the plan’s student limit stops admissions beyond it', async () => {
    const A = as(tok.ADMIN);
    const cls = await A.post('/academics/classes', { name: 'Class 1', level: 1, sections: ['A'] });
    const admit = (name: string, phone: string) => A.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`, name, sectionId: cls.body.data.sections[0].id, guardians: [{ name: 'Parent', phone, relation: 'FATHER', isPrimary: true }] });
    expect((await admit('First', '03001110001')).status).toBe(201);
    await set({ maxStudents: 1 });
    const full = await admit('Second', '03001110002');
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/plan allows 1 active students/);
    expect((await as(tok.OWNER).get('/licence')).body.data).toMatchObject({ activeStudents: 1, status: { maxStudents: 1 } });
    await set({ maxStudents: 2 });
    expect((await admit('Second', '03001110002')).status).toBe(201);
    await set({ maxStudents: null });
    expect((await admit('Third', '03001110003')).status).toBe(201);
  });

  it('a school can be created with its subscription already set', async () => {
    const code = `lic-new-${Date.now()}`;
    const made = await as(tok.SUPER).post('/platform/schools', {
      name: 'Licensed School', code, academicYear: { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
      owner: { name: 'New Owner', email: `owner.${code}@test.local`, password: 'Initial@123' },
      licence: { plan: 'Starter', paidUntil: day(14), maxStudents: 200 },
    });
    expect(made.status).toBe(201);
    try {
      const view = (await as(tok.SUPER).get(`/platform/schools/${made.body.data.school.id}/licence`)).body.data;
      expect(view.status).toMatchObject({ state: 'ACTIVE', plan: 'Starter', paidUntil: day(14), maxStudents: 200 });
    } finally {
      await basePrisma.user.deleteMany({ where: { schoolId: made.body.data.school.id } });
      await basePrisma.academicYear.deleteMany({ where: { schoolId: made.body.data.school.id } });
      await basePrisma.school.delete({ where: { id: made.body.data.school.id } });
    }
  });
});
