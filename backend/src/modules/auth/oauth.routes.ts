import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { basePrisma } from '../../config/database';
import { issueTokens } from './auth.service';

const router = Router();

// OAuth only signs in accounts a school has already created — it never creates
// users, because a new account would have no school and no vetted role.
async function signInExisting(email: string, provider: 'GOOGLE' | 'MICROSOFT', oauthId: string, avatar?: string) {
  const user = await basePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) return null;
  if (user.oauthId && user.oauthId !== oauthId) return null;
  if (!user.oauthId) {
    await basePrisma.user.update({
      where: { id: user.id },
      data: { oauthProvider: provider, oauthId, ...(avatar && !user.avatar ? { avatar } : {}) },
    });
  }
  if (user.role !== 'SUPER_ADMIN') {
    const school = user.schoolId
      ? await basePrisma.school.findUnique({ where: { id: user.schoolId }, select: { isActive: true } })
      : null;
    if (!school?.isActive) return null;
  }
  return { user, ...(await issueTokens(user)) };
}

function redirectWithTokens(res: Response, r: NonNullable<Awaited<ReturnType<typeof signInExisting>>>) {
  // Tokens go in the URL fragment so they are not sent to servers or written to access logs.
  const frag = new URLSearchParams({ accessToken: r.accessToken, refreshToken: r.refreshToken, role: r.user.role });
  res.redirect(`${process.env.FRONTEND_URL}/oauth-callback#${frag}`);
}

// ─── Google OAuth 2.0 ────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = `${process.env.BACKEND_URL}/api/v1/auth/oauth/google/callback`;

router.get('/google', (_req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token } = tokenRes.data;

    // Fetch user info
    const userInfo = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { email, picture, sub: googleId } = userInfo.data;

    const result = await signInExisting(email, 'GOOGLE', googleId, picture);
    if (!result) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_account`);
    redirectWithTokens(res, result);
  } catch (err) {
    console.error('OAuth error', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
});

// ─── Microsoft OAuth 2.0 ─────────────────────────────────────────────────────

const MS_CLIENT_ID = process.env.MS_CLIENT_ID!;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET!;
const MS_TENANT_ID = process.env.MS_TENANT_ID || 'common';
const MS_REDIRECT_URI = `${process.env.BACKEND_URL}/api/v1/auth/oauth/microsoft/callback`;

router.get('/microsoft', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile User.Read',
    response_mode: 'query',
  });
  res.redirect(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/authorize?${params}`);
});

router.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);

  try {
    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
      new URLSearchParams({
        code: code as string,
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        redirect_uri: MS_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const userInfo = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });

    const { mail, id: msId } = userInfo.data;
    const email = mail || userInfo.data.userPrincipalName;

    const result = await signInExisting(email, 'MICROSOFT', msId);
    if (!result) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_account`);
    redirectWithTokens(res, result);
  } catch (err) {
    console.error('MS OAuth error', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
});

export default router;
