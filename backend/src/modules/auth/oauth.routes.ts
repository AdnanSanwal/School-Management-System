import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { z } from 'zod';
import { basePrisma } from '../../config/database';
import { getRedis } from '../../config/redis';
import { issueTokens } from './auth.service';
import logger from '../../utils/logger';
import { mfaLimiter } from '../../middleware/rateLimits';

/**
 * Sign in with Google / Microsoft (SECURITY_FINDINGS AUTH-1..3).
 *  - Off unless OAUTH_ENABLED=true and the provider's client id + secret are set. Microsoft
 *    also needs MS_TENANT_ID pinned to the school group's own tenant ("common",
 *    "organizations" and "consumers" are refused): with a multi-tenant app anyone can create
 *    a tenant whose user "mail" is someone else's address.
 *  - Google accounts must have a verified email.
 *  - `state` (bound to the browser by an HttpOnly cookie) and PKCE protect the round trip.
 *  - Accounts with two-step login must use the password sign-in (OAuth would skip the code).
 *  - Tokens never travel in a URL: the callback hands the web app a one-time code (60 s)
 *    that it exchanges with POST /auth/oauth/exchange.
 * OAuth only signs in accounts a school has already created — it never creates users.
 */

const router = Router();

const MULTI_TENANT = new Set(['common', 'organizations', 'consumers']);
const enabled = () => process.env.OAUTH_ENABLED === 'true';
export const googleEnabled = () => enabled() && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
export const microsoftEnabled = () => enabled() && !!process.env.MS_CLIENT_ID && !!process.env.MS_CLIENT_SECRET
  && !!process.env.MS_TENANT_ID && !MULTI_TENANT.has(process.env.MS_TENANT_ID.toLowerCase());

const frontend = () => process.env.FRONTEND_URL ?? '';
const fail = (res: Response, error: string) => res.redirect(`${frontend()}/login?error=${error}`);

// ─── state + PKCE, kept server-side and bound to the browser by a cookie ───

const STATE_TTL = 600; // seconds
const COOKIE = 'oauth_state';

function setStateCookie(res: Response, state: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${state}; Max-Age=${STATE_TTL}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax${secure}`);
}
function clearStateCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax`);
}
function cookieState(req: Request) {
  const m = /(?:^|;\s*)oauth_state=([a-f0-9]{32,64})/.exec(req.headers.cookie ?? '');
  return m?.[1] ?? null;
}

async function begin(res: Response, provider: 'GOOGLE' | 'MICROSOFT') {
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  await getRedis().setex(`oauth:state:${state}`, STATE_TTL, JSON.stringify({ provider, verifier }));
  setStateCookie(res, state);
  return { state, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

/** The verifier for this callback, if `state` matches the browser's cookie and hasn't been used. */
async function finish(req: Request, res: Response, provider: 'GOOGLE' | 'MICROSOFT'): Promise<string | null> {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const cookie = cookieState(req);
  clearStateCookie(res);
  if (!state || !cookie || state.length !== cookie.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return null;
  const r = getRedis();
  const raw = await r.get(`oauth:state:${state}`);
  await r.del(`oauth:state:${state}`); // single use
  if (!raw) return null;
  const saved = JSON.parse(raw) as { provider: string; verifier: string };
  return saved.provider === provider ? saved.verifier : null;
}

// ─── sign-in + one-time code ───

type SignIn = { ok: true; code: string } | { ok: false; error: string };

async function signInExisting(email: string, provider: 'GOOGLE' | 'MICROSOFT', oauthId: string, avatar?: string): Promise<SignIn> {
  const user = await basePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) return { ok: false, error: 'no_account' };
  if (user.oauthId && (user.oauthId !== oauthId || user.oauthProvider !== provider)) return { ok: false, error: 'no_account' };
  // Two-step login can't be skipped by signing in through a provider.
  if (user.mfaEnabled) return { ok: false, error: 'mfa_required' };
  if (user.role !== 'SUPER_ADMIN') {
    const school = user.schoolId ? await basePrisma.school.findUnique({ where: { id: user.schoolId }, select: { isActive: true } }) : null;
    if (!school?.isActive) return { ok: false, error: 'no_account' };
  }
  if (!user.oauthId) {
    await basePrisma.user.update({ where: { id: user.id }, data: { oauthProvider: provider, oauthId, ...(avatar && !user.avatar ? { avatar } : {}) } });
  }
  const tokens = await issueTokens(user);
  const code = crypto.randomBytes(32).toString('base64url');
  await getRedis().setex(`oauth:code:${code}`, 60, JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }));
  return { ok: true, code };
}

function redirectWithCode(res: Response, r: SignIn) {
  if (!r.ok) return fail(res, r.error);
  // The fragment never reaches servers or access logs; the code is single-use and expires in 60 s.
  res.redirect(`${frontend()}/oauth-callback#code=${r.code}`);
}

/** The web app trades the one-time code for the session tokens. */
router.post('/exchange', mfaLimiter, async (req: Request, res: Response) => {
  const parsed = z.object({ code: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid sign-in code' });
  const r = getRedis();
  const key = `oauth:code:${parsed.data.code}`;
  const raw = await r.get(key);
  await r.del(key);
  if (!raw) return res.status(401).json({ success: false, message: 'Sign-in code expired. Please try again.' });
  return res.json({ success: true, data: JSON.parse(raw) });
});

// ─── Google ───

const googleRedirect = () => `${process.env.BACKEND_URL}/api/v1/auth/oauth/google/callback`;

router.get('/google', async (_req: Request, res: Response) => {
  if (!googleEnabled()) return res.status(404).json({ success: false, message: 'Google sign-in is not enabled' });
  const { state, challenge } = await begin(res, 'GOOGLE');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: googleRedirect(), response_type: 'code',
    scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  if (!googleEnabled()) return res.status(404).json({ success: false, message: 'Google sign-in is not enabled' });
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  try {
    const verifier = await finish(req, res, 'GOOGLE');
    if (!code || !verifier) return fail(res, 'oauth_failed');
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirect(), grant_type: 'authorization_code', code_verifier: verifier,
    }, { timeout: 10_000 });
    const info = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }, timeout: 10_000,
    });
    const { email, email_verified: verified, picture, sub } = info.data as { email?: string; email_verified?: boolean; picture?: string; sub?: string };
    if (!email || verified !== true || !sub) return fail(res, 'no_account');
    redirectWithCode(res, await signInExisting(email, 'GOOGLE', sub, picture));
  } catch (err) {
    logger.warn('Google OAuth failed', { error: (err as Error).message });
    fail(res, 'oauth_failed');
  }
});

// ─── Microsoft (single tenant only) ───

const msRedirect = () => `${process.env.BACKEND_URL}/api/v1/auth/oauth/microsoft/callback`;

router.get('/microsoft', async (_req: Request, res: Response) => {
  if (!microsoftEnabled()) return res.status(404).json({ success: false, message: 'Microsoft sign-in is not enabled' });
  const { state, challenge } = await begin(res, 'MICROSOFT');
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!, redirect_uri: msRedirect(), response_type: 'code', response_mode: 'query',
    scope: 'openid email profile User.Read', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  res.redirect(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MS_TENANT_ID!)}/oauth2/v2.0/authorize?${params}`);
});

router.get('/microsoft/callback', async (req: Request, res: Response) => {
  if (!microsoftEnabled()) return res.status(404).json({ success: false, message: 'Microsoft sign-in is not enabled' });
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  try {
    const verifier = await finish(req, res, 'MICROSOFT');
    if (!code || !verifier) return fail(res, 'oauth_failed');
    const tenant = encodeURIComponent(process.env.MS_TENANT_ID!);
    const tokenRes = await axios.post(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, new URLSearchParams({
      code, client_id: process.env.MS_CLIENT_ID!, client_secret: process.env.MS_CLIENT_SECRET!,
      redirect_uri: msRedirect(), grant_type: 'authorization_code', code_verifier: verifier,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 });
    const me = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }, timeout: 10_000,
    });
    // The tenant is pinned, so its administrators vouch for the mailbox address.
    const { mail, id } = me.data as { mail?: string; id?: string };
    if (!mail || !id) return fail(res, 'no_account');
    redirectWithCode(res, await signInExisting(mail, 'MICROSOFT', id));
  } catch (err) {
    logger.warn('Microsoft OAuth failed', { error: (err as Error).message });
    fail(res, 'oauth_failed');
  }
});

export default router;
