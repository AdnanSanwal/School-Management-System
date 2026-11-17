import { basePrisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { decrypt, encrypt } from '../../utils/encryption';
import { PROVIDERS, type Provider } from './providers';

/**
 * Which AI account a school's request runs on, and how much it may use.
 *
 *   own key     the school connected its own account (Settings, AI). It pays its provider
 *               directly, so the platform sets no limit. The platform admin can switch this
 *               option off for a school.
 *   platform    the platform admin provides AI to the school: a provider, a model, and a
 *               daily and monthly limit on drafts. Used when the school has no key of its own.
 *
 * Keys are stored encrypted and never sent back to a browser; screens see the last four
 * characters only.
 */

export type AiSource = 'OWN' | 'PLATFORM';
export interface ResolvedAi { source: AiSource; provider: Provider; model: string; apiKey: string }

export function seal(key: string): string {
  try { return encrypt(key.trim()); } catch {
    // A missing or malformed AES_SECRET_KEY: say so, rather than a bare server error.
    throw new AppError('The key could not be saved because the server encryption key (AES_SECRET_KEY) is not set up correctly. Ask the server administrator to fix it.', 500);
  }
}
const open = (sealed: string | null | undefined): string | null => {
  if (!sealed) return null;
  try { return decrypt(sealed); } catch { return null; } // sealed with a different AES_SECRET_KEY
};
/** "••••abcd": enough to recognise a key, not enough to use it. */
export const hint = (sealed: string | null | undefined): string | null => {
  const key = open(sealed);
  return key ? `••••${key.slice(-4)}` : null;
};
export const isProvider = (p: string | null | undefined): p is Provider => !!p && p in PROVIDERS;
const modelFor = (provider: Provider, ...choices: (string | null | undefined)[]) => choices.find((c) => c && c.trim())?.trim() ?? PROVIDERS[provider].defaultModel;

/** The platform's key for a provider: the saved one, or ANTHROPIC_API_KEY from the environment. */
async function platformKey(provider: Provider): Promise<{ apiKey: string; model: string | null } | null> {
  const row = await basePrisma.platformAiKey.findUnique({ where: { provider } });
  const saved = open(row?.apiKey);
  if (saved) return { apiKey: saved, model: row?.model ?? null };
  if (provider === 'ANTHROPIC' && process.env.ANTHROPIC_API_KEY) return { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_PAPER_MODEL || null };
  return null;
}

/** The account this school's AI requests run on, or null when AI is not set up for it. */
export async function resolveAi(schoolId: string): Promise<ResolvedAi | null> {
  const s = await basePrisma.aiSetting.findUnique({ where: { schoolId } });
  if (!s) return null;
  const own = s.ownAllowed && isProvider(s.ownProvider) ? open(s.ownKey) : null;
  if (own && isProvider(s.ownProvider)) return { source: 'OWN', provider: s.ownProvider, model: modelFor(s.ownProvider, s.ownModel), apiKey: own };
  if (s.grantEnabled && isProvider(s.grantProvider)) {
    const dedicated = open(s.grantKey);
    if (dedicated) return { source: 'PLATFORM', provider: s.grantProvider, model: modelFor(s.grantProvider, s.grantModel), apiKey: dedicated };
    const shared = await platformKey(s.grantProvider);
    if (shared) return { source: 'PLATFORM', provider: s.grantProvider, model: modelFor(s.grantProvider, s.grantModel, shared.model), apiKey: shared.apiKey };
  }
  return null;
}

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Drafts made on the platform's account today and this month (UTC), and on the school's own. */
export async function usageOf(schoolId: string, now = new Date()) {
  const rows = await basePrisma.aiUsage.groupBy({
    by: ['source'], where: { schoolId, createdAt: { gte: startOfMonth(now) } }, _count: true, _sum: { inputTokens: true, outputTokens: true },
  });
  const today = await basePrisma.aiUsage.groupBy({ by: ['source'], where: { schoolId, createdAt: { gte: startOfDay(now) } }, _count: true });
  const pick = (list: { source: string; _count: number }[], source: AiSource) => list.find((r) => r.source === source)?._count ?? 0;
  const tokens = rows.reduce((n, r) => n + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0);
  return {
    platform: { today: pick(today, 'PLATFORM'), month: pick(rows, 'PLATFORM') },
    own: { today: pick(today, 'OWN'), month: pick(rows, 'OWN') },
    tokensThisMonth: tokens,
  };
}

/** Refuses a draft on the platform's account once the school has used its allowance. */
export async function assertWithinLimits(schoolId: string, ai: ResolvedAi): Promise<void> {
  if (ai.source !== 'PLATFORM') return;
  const s = await basePrisma.aiSetting.findUnique({ where: { schoolId }, select: { dailyLimit: true, monthlyLimit: true } });
  if (s?.dailyLimit == null && s?.monthlyLimit == null) return;
  const used = (await usageOf(schoolId)).platform;
  if (s.monthlyLimit != null && used.month >= s.monthlyLimit) throw new AppError(`Your school has used all ${s.monthlyLimit} AI drafts for this month. The allowance starts again on the 1st. You can still build papers from the question bank or paste one.`, 429);
  if (s.dailyLimit != null && used.today >= s.dailyLimit) throw new AppError(`Your school has used today's ${s.dailyLimit} AI drafts. Try again tomorrow, or build the paper from the question bank.`, 429);
}

export async function recordUsage(entry: { schoolId: string; userId: string; ai: ResolvedAi; feature: string; questions?: number; inputTokens?: number; outputTokens?: number }): Promise<void> {
  await basePrisma.aiUsage.create({
    data: {
      schoolId: entry.schoolId, userId: entry.userId, source: entry.ai.source, provider: entry.ai.provider, model: entry.ai.model.slice(0, 80),
      feature: entry.feature, questions: entry.questions ?? 0, inputTokens: entry.inputTokens ?? 0, outputTokens: entry.outputTokens ?? 0,
    },
  });
}

/** What a school is shown about its AI: which account is in use and what is left. Never a key. */
export async function statusOf(schoolId: string) {
  const [s, ai, usage] = await Promise.all([basePrisma.aiSetting.findUnique({ where: { schoolId } }), resolveAi(schoolId), usageOf(schoolId)]);
  const left = (limit: number | null | undefined, used: number) => (limit == null ? null : Math.max(0, limit - used));
  return {
    active: ai ? { source: ai.source, provider: ai.provider, model: ai.model } : null,
    own: { allowed: s?.ownAllowed ?? true, provider: isProvider(s?.ownProvider) ? s.ownProvider : null, model: s?.ownModel ?? null, keyHint: hint(s?.ownKey) },
    platform: {
      enabled: !!s?.grantEnabled, provider: isProvider(s?.grantProvider) ? s.grantProvider : null,
      dailyLimit: s?.dailyLimit ?? null, monthlyLimit: s?.monthlyLimit ?? null,
      leftToday: left(s?.dailyLimit, usage.platform.today), leftThisMonth: left(s?.monthlyLimit, usage.platform.month),
    },
    usage,
  };
}
