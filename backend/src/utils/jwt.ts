import jwt from 'jsonwebtoken';

export interface JwtPayload {
  id: string;
  role: string;
  email: string | null;
  /** null only for SUPER_ADMIN (platform operator). */
  schoolId: string | null;
  /** Sign-in session (one per device); see utils/sessions.ts. */
  sid?: string;
  /** Must set their own password before using the app (admin-chosen password). */
  pwc?: boolean;
  /** Issue time in milliseconds: lets "sign out everywhere" cut off tokens issued in the same second. */
  iam?: number;
  /** What the token is for; an access token is never accepted as a refresh token or the other way round. */
  typ?: 'access' | 'refresh';
  /** Set by jsonwebtoken when verifying. */
  iat?: number;
  exp?: number;
}

function clean({ id, role, email, schoolId, sid, pwc }: JwtPayload, typ: 'access' | 'refresh'): JwtPayload {
  return { id, role, email: email ?? null, schoolId: schoolId ?? null, ...(sid ? { sid } : {}), ...(pwc ? { pwc: true } : {}), iam: Date.now(), typ };
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(clean(payload, 'access'), process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    // Short-lived: a leaked token stops working soon. Web and mobile refresh it silently.
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(clean(payload, 'refresh'), process.env.REFRESH_TOKEN_SECRET!, {
    algorithm: 'HS256',
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const p = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
  if (p.typ && p.typ !== 'access') throw new jwt.JsonWebTokenError('wrong token type');
  return p;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const p = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
  if (p.typ && p.typ !== 'refresh') throw new jwt.JsonWebTokenError('wrong token type');
  return p;
}
