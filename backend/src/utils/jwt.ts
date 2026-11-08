import jwt from 'jsonwebtoken';

export interface JwtPayload {
  id: string;
  role: string;
  email: string;
  /** null only for SUPER_ADMIN (platform operator). */
  schoolId: string | null;
  /** Sign-in session (one per device); see utils/sessions.ts. */
  sid?: string;
  /** Set by jsonwebtoken when verifying. */
  iat?: number;
  exp?: number;
}

function clean({ id, role, email, schoolId, sid }: JwtPayload): JwtPayload {
  return { id, role, email, schoolId: schoolId ?? null, ...(sid ? { sid } : {}) };
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(clean(payload), process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    // Short-lived: a leaked token stops working soon. Web and mobile refresh it silently.
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(clean(payload), process.env.REFRESH_TOKEN_SECRET!, {
    algorithm: 'HS256',
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
}
