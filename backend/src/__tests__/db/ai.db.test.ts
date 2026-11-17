/**
 * AI settings: a school's own account, AI provided by the platform, limits and usage.
 * The AI services themselves are replaced by a stand-in, so nothing leaves the machine.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/ai
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { resolveAi } from '../../modules/ai/ai.service';
import * as providers from '../../modules/ai/providers';
import { createTestSchool } from './helpers';

jest.mock('../../modules/ai/providers', () => ({
  ...jest.requireActual('../../modules/ai/providers'),
  generateJson: jest.fn(),
  testConnection: jest.fn(),
}));
const generateJson = providers.generateJson as jest.Mock;
const testConnection = providers.testConnection as jest.Mock;

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(180_000);

const DRAFT = { sections: [{ type: 'MCQ', title: 'MCQs', items: [
  { text: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctOption: 1, isTrue: false, answer: '', pairs: [] },
  { text: 'What is 3 + 3?', options: ['6', '7', '8', '9'], correctOption: 0, isTrue: false, answer: '', pairs: [] },
] }] };

d('AI settings (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  type TestUser = Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>;
  const u: Record<string, TestUser> = {};
  const ids: Record<string, string> = {};
  let savedKeys: Awaited<ReturnType<typeof basePrisma.platformAiKey.findMany>> = [];
  const envKey = process.env.ANTHROPIC_API_KEY;

  const as = (who: TestUser) => {
    const h = { Authorization: `Bearer ${who.token}` };
    return {
      get: (url: string) => request(app).get(`/api/v1${url}`).set(h),
      post: (url: string, body: object = {}) => request(app).post(`/api/v1${url}`).set(h).send(body),
      put: (url: string, body: object = {}) => request(app).put(`/api/v1${url}`).set(h).send(body),
      del: (url: string) => request(app).delete(`/api/v1${url}`).set(h).send({}),
    };
  };
  const draft = (who: TestUser = u.ADMIN) => as(who).post('/testmaker/papers/ai', {
    classId: ids.cls, subjectId: ids.maths, language: 'EN', topic: 'Addition', mix: [{ type: 'MCQ', count: 2, marksEach: 1 }],
  });
  const grant = (body: object) => as(u.SUPER).put(`/platform/ai/schools/${t.school.id}`, body);

  beforeAll(async () => {
    await connectRedis();
    delete process.env.ANTHROPIC_API_KEY;
    savedKeys = await basePrisma.platformAiKey.findMany();
    await basePrisma.platformAiKey.deleteMany({});
    t = await createTestSchool('ai');
    other = await createTestSchool('ai-other');
    for (const role of ['OWNER', 'ADMIN', 'PRINCIPAL', 'TEACHER'] as const) u[role] = await t.user(role);
    u.SUPER = await other.user('SUPER_ADMIN');
    u.otherAdmin = await other.user('ADMIN', 'admin2');
    const cls = await basePrisma.class.create({ data: { schoolId: t.school.id, name: 'Class 5', level: 5 } });
    const maths = await basePrisma.subject.create({ data: { schoolId: t.school.id, name: 'Mathematics', code: 'MATH' } });
    Object.assign(ids, { cls: cls.id, maths: maths.id });
  });
  beforeEach(() => {
    generateJson.mockReset().mockResolvedValue({ data: DRAFT, inputTokens: 900, outputTokens: 400 });
    testConnection.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await basePrisma.platformAiKey.deleteMany({});
    if (savedKeys.length) await basePrisma.platformAiKey.createMany({ data: savedKeys });
    if (envKey !== undefined) process.env.ANTHROPIC_API_KEY = envKey;
    await t.destroy();
    await other.destroy();
  });

  it('is off until someone sets it up; only people who manage the school may', async () => {
    expect((await as(u.TEACHER).get('/ai/settings')).status).toBe(403);
    expect((await as(u.PRINCIPAL).put('/ai/settings', { provider: 'OPENAI', apiKey: 'sk-test-12345678' })).status).toBe(403);
    expect((await as(u.ADMIN).get('/platform/ai')).status).toBe(403);
    const fresh = (await as(u.ADMIN).get('/ai/settings')).body.data;
    expect(fresh.active).toBeNull();
    expect(fresh.providers.map((p: any) => p.id)).toEqual(['ANTHROPIC', 'OPENAI', 'GEMINI', 'GROK']);
    expect((await as(u.ADMIN).get('/testmaker/scope')).body.data.ai).toBe(false);
    expect((await draft()).status).toBe(503);
    expect((await as(u.ADMIN).post('/ai/test')).status).toBe(422);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('a school connects its own account; the key is stored sealed and never sent back', async () => {
    expect((await as(u.ADMIN).put('/ai/settings', { provider: 'OPENAI' })).status).toBe(422); // no key yet
    expect((await as(u.ADMIN).put('/ai/settings', { provider: 'BARD', apiKey: 'sk-test-12345678' })).status).toBe(422);
    expect((await as(u.ADMIN).put('/ai/settings', { provider: 'OPENAI', apiKey: 'has a space' })).status).toBe(422);
    const saved = await as(u.ADMIN).put('/ai/settings', { provider: 'OPENAI', model: 'gpt-test', apiKey: 'sk-test-secret-WXYZ' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.active).toEqual({ source: 'OWN', provider: 'OPENAI', model: 'gpt-test' });
    expect(saved.body.data.own.keyHint).toBe('••••WXYZ');
    expect(JSON.stringify(saved.body)).not.toContain('sk-test-secret');
    const row = await basePrisma.aiSetting.findUniqueOrThrow({ where: { schoolId: t.school.id } });
    expect(row.ownKey).not.toContain('sk-test-secret');

    // Changing the model alone keeps the key; a different provider needs its own key.
    expect((await as(u.OWNER).put('/ai/settings', { provider: 'OPENAI', model: null })).body.data.active.model).toBe('gpt-5');
    expect((await as(u.OWNER).put('/ai/settings', { provider: 'GEMINI' })).status).toBe(422);

    expect((await as(u.ADMIN).post('/ai/test')).status).toBe(200);
    expect(testConnection).toHaveBeenCalledWith('OPENAI', 'gpt-5', 'sk-test-secret-WXYZ');
    // Another school is untouched.
    expect((await as(u.otherAdmin).get('/ai/settings')).body.data.active).toBeNull();
  });

  it('drafts a paper on the school\'s own account, with no platform limit, and records the use', async () => {
    await grant({ enabled: false, dailyLimit: 0, monthlyLimit: 0 }); // limits apply to the platform's account only
    const res = await draft(u.ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.sections[0].items).toHaveLength(2);
    expect(generateJson.mock.calls[0][0]).toMatchObject({ provider: 'OPENAI', model: 'gpt-5', apiKey: 'sk-test-secret-WXYZ' });
    expect(generateJson.mock.calls[0][0].prompt).toContain('Class: Class 5');
    const used = await basePrisma.aiUsage.findMany({ where: { schoolId: t.school.id } });
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ source: 'OWN', provider: 'OPENAI', feature: 'PAPER', questions: 2, inputTokens: 900, outputTokens: 400, userId: u.ADMIN.id });
    expect((await as(u.ADMIN).get('/testmaker/scope')).body.data.ai).toBe(true);
  });

  it('a failed request is reported and not counted', async () => {
    const { AppError } = jest.requireActual('../../middleware/errorHandler');
    generateJson.mockRejectedValueOnce(new AppError('OpenAI (ChatGPT) rejected the API key. Check the key in the AI settings.', 502));
    const res = await draft();
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/rejected the API key/);
    expect(await basePrisma.aiUsage.count({ where: { schoolId: t.school.id } })).toBe(1);
  });

  it('the platform admin provides AI to a school and limits it', async () => {
    expect((await as(u.ADMIN).del('/ai/settings')).body.data.active).toBeNull();
    // Provided, but the platform has no key for that provider yet: still off.
    expect((await grant({ enabled: true })).status).toBe(422);
    expect((await grant({ enabled: true, provider: 'GROK', dailyLimit: 5, monthlyLimit: 2 })).status).toBe(422); // daily above monthly
    expect((await grant({ enabled: true, provider: 'GROK', dailyLimit: 2, monthlyLimit: 3 })).status).toBe(200);
    expect(await resolveAi(t.school.id)).toBeNull();

    expect((await as(u.SUPER).put('/platform/ai/keys/GROK', {})).status).toBe(422);
    const keys = await as(u.SUPER).put('/platform/ai/keys/GROK', { apiKey: 'xai-platform-key-QRST', model: 'grok-test' });
    expect(keys.status).toBe(200);
    expect(keys.body.data.keys.find((k: any) => k.provider === 'GROK')).toEqual({ provider: 'GROK', keyHint: '••••QRST', model: 'grok-test' });
    expect(JSON.stringify(keys.body)).not.toContain('xai-platform-key');
    expect(await resolveAi(t.school.id)).toEqual({ source: 'PLATFORM', provider: 'GROK', model: 'grok-test', apiKey: 'xai-platform-key-QRST' });

    // The school sees what it has been given, and what is left.
    const seen = (await as(u.ADMIN).get('/ai/settings')).body.data;
    expect(seen.platform).toMatchObject({ enabled: true, provider: 'GROK', dailyLimit: 2, monthlyLimit: 3, leftToday: 2, leftThisMonth: 3 });

    expect((await draft(u.ADMIN)).status).toBe(200);
    expect((await draft(u.ADMIN)).status).toBe(200);
    const third = await draft(u.ADMIN);
    expect(third.status).toBe(429);
    expect(third.body.message).toMatch(/today's 2 AI drafts/);
    expect(generateJson).toHaveBeenCalledTimes(2); // the refused draft never reached the AI

    // Yesterday's drafts do not count against today, but do count against the month.
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    if (yesterday.getUTCMonth() === new Date().getUTCMonth()) {
      await basePrisma.aiUsage.updateMany({ where: { schoolId: t.school.id, source: 'PLATFORM' }, data: { createdAt: yesterday } });
      expect((await draft()).status).toBe(200);
      const fourth = await draft();
      expect(fourth.status).toBe(429);
      expect(fourth.body.message).toMatch(/all 3 AI drafts for this month/);
    }

    // The admin's list shows each school's use.
    const list = (await as(u.SUPER).get('/platform/ai')).body.data.schools;
    const mine = list.find((s: any) => s.id === t.school.id);
    expect(mine.grant).toMatchObject({ enabled: true, provider: 'GROK', dailyLimit: 2, monthlyLimit: 3 });
    expect(mine.usage.platform.month).toBeGreaterThanOrEqual(2);
    expect(list.find((s: any) => s.id === other.school.id).grant.enabled).toBe(false);

    // Raising the limit lets the school carry on; no limit at all is allowed too.
    expect((await grant({ enabled: true, provider: 'GROK', dailyLimit: null, monthlyLimit: null })).status).toBe(200);
    expect((await draft()).status).toBe(200);
  });

  it('a key just for one school, and switching off a school\'s own key', async () => {
    await grant({ enabled: true, provider: 'GEMINI', apiKey: 'gem-school-key-ABCD' });
    expect(await resolveAi(t.school.id)).toMatchObject({ source: 'PLATFORM', provider: 'GEMINI', model: 'gemini-2.5-flash', apiKey: 'gem-school-key-ABCD' });

    // The school's own key comes first while it is allowed...
    await as(u.ADMIN).put('/ai/settings', { provider: 'ANTHROPIC', apiKey: 'sk-ant-own-key-MNOP' });
    expect(await resolveAi(t.school.id)).toMatchObject({ source: 'OWN', provider: 'ANTHROPIC', model: 'claude-opus-5-5' });
    // ...and is ignored once the platform admin switches that off.
    await grant({ enabled: true, provider: 'GEMINI', ownAllowed: false });
    expect(await resolveAi(t.school.id)).toMatchObject({ source: 'PLATFORM', provider: 'GEMINI', apiKey: 'gem-school-key-ABCD' });
    expect((await as(u.ADMIN).put('/ai/settings', { provider: 'ANTHROPIC', apiKey: 'sk-ant-own-key-MNOP' })).status).toBe(403);

    // Switched off altogether.
    await grant({ enabled: false, ownAllowed: false, apiKey: '' });
    expect(await resolveAi(t.school.id)).toBeNull();
    expect((await draft()).status).toBe(503);
    expect((await as(u.SUPER).del('/platform/ai/keys/GROK')).status).toBe(200);
    expect((await as(u.SUPER).put('/platform/ai/schools/00000000-0000-4000-8000-000000000000', { enabled: false })).status).toBe(404);
  });
});
