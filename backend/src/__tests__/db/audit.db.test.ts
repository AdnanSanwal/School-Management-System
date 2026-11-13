import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { seedReports } from '../../database/seedReports';
import { signToken } from '../../utils/jwt';

const suite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
suite('Audit viewer — retained QA data', () => {
  let f: Awaited<ReturnType<typeof seedReports>>;
  const tokens: Record<string, string> = {};
  const first = 'a0d17000-0000-4000-8000-000000000001';
  const other = 'a0d17000-0000-4000-8000-000000000002';
  const prefix = 'QA audit viewer';
  const get = (q: Record<string, string | number> = {}, role = 'OWNER') => request(app).get('/api/v1/audit').query(q).auth(tokens[role], { type: 'bearer' });
  beforeAll(async () => {
    await connectRedis(); f = await seedReports();
    for (const u of f.users) tokens[u.role] = signToken({ id: u.id, schoolId: f.main.id, role: u.role, email: u.email });
    const owner = f.users.find(u => u.role === 'OWNER')!;
    // Fixed IDs make reruns idempotent. All QA events are retained, never deleted.
    await basePrisma.auditLog.createMany({ skipDuplicates: true, data: [
      { id: first, schoolId: f.main.id, userId: owner.id, action: `${prefix}: status changed`, entity: 'students', entityId: 'QA-STUDENT-RECORD', createdAt: new Date('2026-11-09T19:00:00Z'), ipAddress: '192.0.2.10', meta: { status: { from: 'ACTIVE', to: 'LEFT' }, reason: 'Retained audit viewer fixture', nested: { password: 'dummy-sensitive-value', accessToken: 'dummy-token-value', note: 'Safe note' } } },
      { id: other, schoolId: f.other.id, userId: owner.id, action: `${prefix}: isolation sentinel`, entity: 'isolation-audit-only', createdAt: new Date('2026-11-10T00:00:00Z'), meta: { note: 'Other branch only' } },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `a0d17100-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, schoolId: f.main.id, userId: owner.id,
        action: i === 0 ? `${prefix}: signed in` : i === 1 ? `POST /qa-audit/${prefix}` : `${prefix}: reviewed fixture ${i}`,
        entity: i === 0 ? 'auth' : 'audit-qa', createdAt: new Date(Date.UTC(2026, 10, 10, 12, i)), meta: { note: 'Retained QA event' },
      })),
    ] });
  }, 90_000);

  it('requires audit.view on both endpoints and refuses unauthenticated users', async () => {
    expect((await request(app).get('/api/v1/audit')).status).toBe(401);
    for (const role of ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']) {
      expect((await get({}, role)).status).toBe(403);
      expect((await request(app).get('/api/v1/audit/options').auth(tokens[role], { type: 'bearer' })).status).toBe(403);
    }
    expect((await get({ search: prefix }, 'PRINCIPAL')).status).toBe(200);
  });
  it('supports stable pagination and filters by module, actor, search and kind', async () => {
    const a = await get({ search: prefix, limit: 10 }); const b = await get({ search: prefix, limit: 10, page: 2 });
    expect(a.status).toBe(200); expect(a.body.pagination).toMatchObject({ total: 31, pages: 4 });
    expect(a.body.data).toHaveLength(10); expect(b.body.data).toHaveLength(10);
    expect(a.body.data.some((v: any) => b.body.data.some((w: any) => w.id === v.id))).toBe(false);
    expect((await get({ search: prefix, kind: 'security' })).body.pagination.total).toBe(1);
    expect((await get({ search: prefix, kind: 'request' })).body.pagination.total).toBe(1);
    expect((await get({ search: prefix, kind: 'activity' })).body.pagination.total).toBe(29);
    const r = await get({ entity: 'students', search: 'QA-STUDENT-RECORD', userId: f.users.find(u => u.role === 'OWNER')!.id });
    expect(r.body.data.map((v: any) => v.id)).toEqual([first]);
    expect((await get({ search: f.users.find(u => u.role === 'OWNER')!.name, entity: 'audit-qa' })).body.pagination.total).toBe(29);
    expect((await get({ search: '192.0.2.10' })).body.data[0].id).toBe(first);
  });
  it('uses inclusive branch-local days and rejects invalid ranges', async () => {
    const r = await get({ search: 'QA-STUDENT-RECORD', from: '2026-11-10', to: '2026-11-10' });
    expect(r.body.timezone).toBe('Asia/Karachi'); expect(r.body.data.map((v: any) => v.id)).toEqual([first]);
    expect((await get({ search: 'QA-STUDENT-RECORD', to: '2026-11-09' })).body.pagination.total).toBe(0);
    const invalid: Record<string, string | number>[] = [{ from: '2026-02-30' }, { from: '2026-11-12', to: '2026-11-01' }, { kind: 'invalid' }, { limit: 201 }, { userId: 'invalid' }];
    for (const q of invalid) expect((await get(q)).status).toBe(422);
  });
  it('never returns another branch rows/options and redacts nested credentials', async () => {
    expect((await get({ entity: 'isolation-audit-only' })).body.data).toEqual([]);
    expect((await get({ search: 'isolation sentinel' })).body.data).toEqual([]);
    const options = await request(app).get('/api/v1/audit/options').auth(tokens.OWNER, { type: 'bearer' });
    expect(options.status).toBe(200); expect(options.body.data.entities).not.toContain('isolation-audit-only');
    expect(options.body.data.users.some((u: any) => 'email' in u || 'password' in u)).toBe(false);
    const r = await get({ search: 'QA-STUDENT-RECORD' });
    expect(r.body.data[0].meta.nested).toEqual({ password: '[redacted]', accessToken: '[redacted]', note: 'Safe note' });
    expect(JSON.stringify(r.body)).not.toContain('dummy-sensitive-value');
    expect(r.body.data[0].meta.status).toEqual({ from: 'ACTIVE', to: 'LEFT' });
    expect((await get({ search: 'nothing-matches-this-fixture' })).body.pagination.total).toBe(0);
  });
});
