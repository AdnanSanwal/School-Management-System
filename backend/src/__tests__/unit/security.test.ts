/**
 * Unit-level security regressions (docs/security/SECURITY_FINDINGS.md).
 */
import { validateEnv } from '../../config/env';
import { passwordProblem } from '../../utils/passwordPolicy';
import { isPushServiceUrl } from '../../modules/push/push.controller';
import { scrubEvent } from '../../utils/sentry';
import { needsRehash, BCRYPT_ROUNDS } from '../../utils/password';
import { signToken, signRefreshToken, verifyRefreshToken, verifyToken } from '../../utils/jwt';
import { temporaryPassword } from '../../utils/accounts';
import bcrypt from 'bcryptjs';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://app:pw@db:3306/school_db',
  REDIS_URL: 'redis://:pw@redis:6379',
  JWT_SECRET: 'a'.repeat(40), REFRESH_TOKEN_SECRET: 'b'.repeat(40), FILE_URL_SECRET: 'c'.repeat(40), METRICS_TOKEN: 'd'.repeat(40),
  AES_SECRET_KEY: '0'.repeat(64), FRONTEND_URL: 'https://erp.example.org', BACKEND_URL: 'https://erp.example.org',
} as NodeJS.ProcessEnv;

describe('production configuration (SEC-3, HOOK-5, SEC-1)', () => {
  it('accepts a complete configuration', () => expect(validateEnv(good)).toEqual({ ok: true }));
  it.each([
    ['missing FILE_URL_SECRET', { FILE_URL_SECRET: undefined }],
    ['FILE_URL_SECRET equal to JWT_SECRET', { FILE_URL_SECRET: 'a'.repeat(40) }],
    ['missing METRICS_TOKEN', { METRICS_TOKEN: undefined }],
    ['test messaging provider', { MESSAGING_PROVIDER: 'test' }],
    ['demo seed allowed', { ALLOW_DEMO_SEED: 'true' }],
    ['gateway without its secret', { PAYMENT_GATEWAY: 'jazzcash' }],
  ])('refuses %s', (_name, change) => {
    expect(validateEnv({ ...good, ...change } as NodeJS.ProcessEnv).ok).toBe(false);
  });
});

describe('password policy (AUTH-15)', () => {
  it('refuses common, repeated, personal and over-long passwords', () => {
    expect(passwordProblem('password123')).toMatch(/common/);
    expect(passwordProblem('Admin@123')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaa')).toMatch(/easy/);
    expect(passwordProblem('x'.repeat(73))).toMatch(/too long/);
    expect(passwordProblem('ali.raza!', { username: 'ali.raza' })).toBeNull(); // has more than the username
    expect(passwordProblem('aliraza', { name: 'Ali Raza' })).toMatch(/at least 8/);
    expect(passwordProblem('khan-family-garden-2026')).toBeNull();
  });
  it('temporary passwords are long and varied (AUTH-4)', () => {
    const p = temporaryPassword();
    expect(p).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{6}$/);
    expect(new Set(Array.from({ length: 50 }, temporaryPassword)).size).toBe(50);
  });
  it('never re-hashes to a weaker cost (AUTH-15)', () => {
    expect(needsRehash(bcrypt.hashSync('x', BCRYPT_ROUNDS + 1))).toBe(false);
    expect(needsRehash(bcrypt.hashSync('x', 4))).toBe(true);
  });
});

describe('token types (AUTH-14)', () => {
  beforeAll(() => { process.env.JWT_SECRET = 'same-secret-for-this-test-0123456789'; process.env.REFRESH_TOKEN_SECRET = process.env.JWT_SECRET; });
  it('an access token is not a refresh token and the other way round, even with one secret', () => {
    const p = { id: 'u1', role: 'ADMIN', email: null, schoolId: 's1' };
    expect(() => verifyRefreshToken(signToken(p))).toThrow();
    expect(() => verifyToken(signRefreshToken(p))).toThrow();
    expect(verifyToken(signToken(p)).typ).toBe('access');
  });
});

describe('push endpoints (API-1)', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['https://web.push.apple.com/abc', true],
    ['https://wns2-par02p.notify.windows.com/w/?token=abc', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false],
    ['https://127.0.0.1/x', false],
    ['https://169.254.169.254/latest/meta-data', false],
    ['https://fcm.googleapis.com.attacker.test/x', false],
    ['https://user:pw@fcm.googleapis.com/x', false],
    ['https://fcm.googleapis.com:8443/x', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => expect(isPushServiceUrl(url)).toBe(ok));
});

describe('Sentry scrubbing (LOG-2)', () => {
  it('drops bodies, query strings, cookies, headers and user details', () => {
    const e = scrubEvent({
      request: { method: 'POST', url: 'https://x/api/v1/files/a.pdf?exp=1&sig=SECRET', data: { cnic: '35202-1234567-1' }, cookies: { a: 'b' }, headers: { authorization: 'Bearer t' }, query_string: 'sig=SECRET' },
      user: { id: 'u', email: 'e@x' },
      spans: [{ description: 'GET https://x/files/a?sig=SECRET', data: { 'http.url': 'https://x/?sig=SECRET', other: 1 } }],
    });
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/SECRET|35202|Bearer|e@x/);
    expect(e.request).toEqual({ method: 'POST', url: 'https://x/api/v1/files/a.pdf' });
  });
});
