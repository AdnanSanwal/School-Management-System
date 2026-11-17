import { Router } from 'express';
import { z } from 'zod';
import { basePrisma } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, id, parseBody } from '../../utils/http';
import { audit } from '../../utils/audit';
import { decrypt } from '../../utils/encryption';
import { PROVIDERS, PROVIDER_IDS, testConnection } from './providers';
import { hint, isProvider, resolveAi, seal, statusOf, usageOf } from './ai.service';

/**
 * AI settings.
 *   /ai            a school connects its own AI account (people who manage the school)
 *   /platform/ai   the platform admin's keys, and what each school is provided and allowed
 */

const providerList = PROVIDER_IDS.map((p) => ({ id: p, label: PROVIDERS[p].label, defaultModel: PROVIDERS[p].defaultModel, keysUrl: PROVIDERS[p].keysUrl }));
const provider = z.enum(PROVIDER_IDS);
const model = z.string().trim().max(80).regex(/^[\w.:\-/]*$/, 'A model name has letters, digits, dots and dashes only').nullable().optional();
const apiKey = z.string().trim().min(8, 'That does not look like an API key').max(400).regex(/^\S+$/, 'An API key has no spaces');
const limit = z.coerce.number().int().min(0).max(100_000).nullable().optional();

// ─── The school's own account ───

export const schoolAi = Router();
schoolAi.use(authenticate, can('school.manage'));

schoolAi.get('/settings', handler(async (_req, res) => sendSuccess(res, { providers: providerList, ...(await statusOf(currentSchoolId())) })));

/** Connect or change the school's own account. Leaving the key out keeps the saved one. */
schoolAi.put('/settings', handler(async (req, res) => {
  const b = parseBody(z.object({ provider, model, apiKey: apiKey.optional() }).strict(), req);
  const schoolId = currentSchoolId();
  const existing = await basePrisma.aiSetting.findUnique({ where: { schoolId } });
  if (existing && !existing.ownAllowed) throw new AppError('Your platform administrator has switched off the use of your own AI account for this school.', 403);
  if (!b.apiKey && (!existing?.ownKey || existing.ownProvider !== b.provider)) throw new AppError('Enter the API key for this provider.', 422);
  const data = { ownProvider: b.provider, ownModel: b.model || null, ...(b.apiKey ? { ownKey: seal(b.apiKey) } : {}) };
  await basePrisma.aiSetting.upsert({ where: { schoolId }, update: data, create: { schoolId, ...data } });
  await audit(req, { action: 'AI_SETTINGS_SAVED', entity: 'AiSetting', meta: { provider: b.provider, model: b.model || null, keyChanged: !!b.apiKey } });
  return sendSuccess(res, await statusOf(schoolId), 'AI settings saved');
}));

schoolAi.delete('/settings', handler(async (req, res) => {
  const schoolId = currentSchoolId();
  await basePrisma.aiSetting.updateMany({ where: { schoolId }, data: { ownProvider: null, ownModel: null, ownKey: null } });
  await audit(req, { action: 'AI_SETTINGS_REMOVED', entity: 'AiSetting' });
  return sendSuccess(res, await statusOf(schoolId), 'Your AI account was disconnected');
}));

/** Sends one tiny request on the account in use, to prove the key and model work. */
schoolAi.post('/test', handler(async (_req, res) => {
  const ai = await resolveAi(currentSchoolId());
  if (!ai) throw new AppError('AI is not set up for this school yet.', 422);
  await testConnection(ai.provider, ai.model, ai.apiKey);
  return sendSuccess(res, { provider: ai.provider, model: ai.model, source: ai.source }, `${PROVIDERS[ai.provider].label} answered. AI is ready to use.`);
}));

// ─── Platform admin ───

export const platformAi = Router();
platformAi.use(authenticate, can('platform.manage'));

async function platformView() {
  const [keys, schools, settings] = await Promise.all([
    basePrisma.platformAiKey.findMany(),
    basePrisma.school.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, isActive: true } }),
    basePrisma.aiSetting.findMany(),
  ]);
  const usage = await Promise.all(schools.map((s) => usageOf(s.id)));
  return {
    providers: providerList,
    keys: PROVIDER_IDS.map((p) => {
      const row = keys.find((k) => k.provider === p);
      const fromEnv = !row && p === 'ANTHROPIC' && !!process.env.ANTHROPIC_API_KEY;
      return { provider: p, keyHint: row ? hint(row.apiKey) : fromEnv ? 'set in the server environment' : null, model: row?.model ?? null };
    }),
    schools: schools.map((s, i) => {
      const a = settings.find((x) => x.schoolId === s.id);
      return {
        ...s,
        own: { allowed: a?.ownAllowed ?? true, provider: a?.ownKey && isProvider(a.ownProvider) ? a.ownProvider : null, model: a?.ownModel ?? null },
        grant: {
          enabled: !!a?.grantEnabled, provider: isProvider(a?.grantProvider) ? a.grantProvider : null, model: a?.grantModel ?? null,
          keyHint: hint(a?.grantKey), dailyLimit: a?.dailyLimit ?? null, monthlyLimit: a?.monthlyLimit ?? null,
        },
        usage: usage[i],
      };
    }),
  };
}

platformAi.get('/', handler(async (_req, res) => sendSuccess(res, await platformView())));

/** The platform's key for one provider, shared by every school it provides that AI to. */
platformAi.put('/keys/:provider', handler(async (req, res) => {
  const p = provider.parse(req.params.provider);
  const b = parseBody(z.object({ apiKey: apiKey.optional(), model }).strict(), req);
  const existing = await basePrisma.platformAiKey.findUnique({ where: { provider: p } });
  if (!b.apiKey && !existing) throw new AppError('Enter the API key for this provider.', 422);
  await basePrisma.platformAiKey.upsert({
    where: { provider: p },
    update: { model: b.model || null, ...(b.apiKey ? { apiKey: seal(b.apiKey) } : {}) },
    create: { provider: p, apiKey: seal(b.apiKey!), model: b.model || null },
  });
  await audit(req, { action: 'PLATFORM_AI_KEY_SAVED', entity: 'PlatformAiKey', entityId: p, meta: { keyChanged: !!b.apiKey } });
  return sendSuccess(res, await platformView(), 'Key saved');
}));

platformAi.delete('/keys/:provider', handler(async (req, res) => {
  const p = provider.parse(req.params.provider);
  await basePrisma.platformAiKey.deleteMany({ where: { provider: p } });
  await audit(req, { action: 'PLATFORM_AI_KEY_REMOVED', entity: 'PlatformAiKey', entityId: p });
  return sendSuccess(res, await platformView(), 'Key removed');
}));

platformAi.post('/keys/:provider/test', handler(async (req, res) => {
  const p = provider.parse(req.params.provider);
  const row = await basePrisma.platformAiKey.findUnique({ where: { provider: p } });
  if (!row) throw new AppError('Save a key for this provider first.', 422);
  await testConnection(p, row.model || PROVIDERS[p].defaultModel, decrypt(row.apiKey));
  return sendSuccess(res, null, `${PROVIDERS[p].label} answered. The key works.`);
}));

/** What one school is provided and allowed. */
platformAi.put('/schools/:id', handler(async (req, res) => {
  const schoolId = id.parse(req.params.id);
  const b = parseBody(z.object({
    enabled: z.boolean(),
    provider: provider.nullable().optional(),
    model,
    /** A key just for this school. An empty string removes it; leaving it out keeps it. */
    apiKey: z.union([apiKey, z.literal('')]).optional(),
    dailyLimit: limit,
    monthlyLimit: limit,
    ownAllowed: z.boolean().optional(),
  }).strict(), req);
  if (!(await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) throw new AppError('School not found', 404);
  if (b.enabled && !b.provider) throw new AppError('Choose which AI to provide to this school.', 422);
  if (b.dailyLimit != null && b.monthlyLimit != null && b.dailyLimit > b.monthlyLimit) throw new AppError('The daily limit cannot be more than the monthly limit.', 422);
  const data = {
    grantEnabled: b.enabled, grantProvider: b.provider ?? null, grantModel: b.model || null,
    dailyLimit: b.dailyLimit ?? null, monthlyLimit: b.monthlyLimit ?? null,
    ...(b.ownAllowed !== undefined ? { ownAllowed: b.ownAllowed } : {}),
    ...(b.apiKey !== undefined ? { grantKey: b.apiKey ? seal(b.apiKey) : null } : {}),
  };
  await basePrisma.aiSetting.upsert({ where: { schoolId }, update: data, create: { schoolId, ...data } });
  await audit(req, { action: 'PLATFORM_AI_SCHOOL_SAVED', entity: 'School', entityId: schoolId, meta: { enabled: b.enabled, provider: b.provider ?? null, dailyLimit: b.dailyLimit ?? null, monthlyLimit: b.monthlyLimit ?? null, ownAllowed: b.ownAllowed } });
  return sendSuccess(res, await platformView(), 'Saved');
}));
