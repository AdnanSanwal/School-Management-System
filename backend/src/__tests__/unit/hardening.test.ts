import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { validateEnv } from '../../config/env';
import { requestContext } from '../../middleware/requestContext';
import { errorHandler, AppError } from '../../middleware/errorHandler';
import { signToken, verifyToken } from '../../utils/jwt';
import logger from '../../utils/logger';

describe('start-up configuration check', () => {
  const good = {
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://u:p@db:3306/school',
    REDIS_URL: 'redis://redis:6379',
    JWT_SECRET: 'a'.repeat(40),
    REFRESH_TOKEN_SECRET: 'b'.repeat(40),
    AES_SECRET_KEY: 'c'.repeat(64),
    FRONTEND_URL: 'https://erp.example.org',
    BACKEND_URL: 'https://erp.example.org',
  };

  it('accepts a complete production config', () => expect(validateEnv(good)).toEqual({ ok: true }));

  it.each([
    [{ JWT_SECRET: 'short' }, /at least 32/],
    [{ JWT_SECRET: 'change-me-change-me-change-me-change-me' }, /example value/],
    [{ REFRESH_TOKEN_SECRET: 'a'.repeat(40) }, /must be different/],
    [{ AES_SECRET_KEY: 'xyz' }, /64 hex/],
    [{ REDIS_URL: undefined }, /REDIS_URL is required/],
    [{ PAYMENT_GATEWAY: 'test' }, /not allowed in production/],
  ])('refuses %o', (patch, msg) => {
    const r = validateEnv({ ...good, ...patch } as any);
    expect(r.ok).toBe(false);
    expect((r as any).problems.join(' | ')).toMatch(msg);
  });

  it('only needs the basics in development', () => {
    expect(validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'mysql://x', JWT_SECRET: 'x', REFRESH_TOKEN_SECRET: 'y' })).toEqual({ ok: true });
  });
});

describe('global error handling', () => {
  const app = express();
  app.use(requestContext);
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => res.json(req.body));
  app.get('/app-error', () => { throw new AppError('Class is full', 409); });
  app.get('/zod', () => { z.object({ name: z.string() }).parse({}); });
  app.get('/dup', () => { throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }); });
  app.get('/linked', () => { throw new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }); });
  app.get('/boom', () => { throw new Error('SELECT * FROM users WHERE secret=1 exploded'); });
  app.use(errorHandler);

  beforeAll(() => { jest.spyOn(logger, 'error').mockImplementation(() => logger); jest.spyOn(logger, 'info').mockImplementation(() => logger); });
  afterAll(() => jest.restoreAllMocks());

  it('every response carries a request id, and keeps a sane one from the proxy', async () => {
    const r = await request(app).get('/app-error');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await request(app).get('/app-error').set('X-Request-Id', 'proxy-abc-12345');
    expect(kept.headers['x-request-id']).toBe('proxy-abc-12345');
    const replaced = await request(app).get('/app-error').set('X-Request-Id', '<script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>');
  });

  it('maps known errors to clear statuses', async () => {
    expect((await request(app).get('/app-error')).body).toMatchObject({ success: false, message: 'Class is full' });
    const zod = await request(app).get('/zod');
    expect(zod.status).toBe(422);
    expect(zod.body.errors[0].field).toBe('name');
    expect((await request(app).get('/dup')).status).toBe(409);
    expect((await request(app).get('/linked')).status).toBe(409);
  });

  it('malformed or oversized JSON is a 4xx, not a crash', async () => {
    const bad = await request(app).post('/echo').set('Content-Type', 'application/json').send('{"a":');
    expect(bad.status).toBe(400);
    const big = await request(app).post('/echo').send({ x: 'y'.repeat(5000) });
    expect(big.status).toBe(413);
  });

  it('unexpected errors never leak internals, but give a request id to quote', async () => {
    const r = await request(app).get('/boom');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/SELECT|secret|exploded/);
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
  });
});

describe('logs mask secrets', () => {
  it('redacts sensitive fields at any depth', () => {
    const lines: string[] = [];
    const stream = new (require('stream').Writable)({ write(chunk: Buffer, _e: string, cb: () => void) { lines.push(chunk.toString()); cb(); } });
    const winston = require('winston');
    const t = new winston.transports.Stream({ stream });
    logger.add(t);
    logger.error('login attempt', { email: 'a@b.c', password: 'hunter2', body: { refreshToken: 'abc.def', nested: { authorization: 'Bearer x' } } });
    logger.remove(t);
    const out = lines.join('');
    expect(out).toContain('a@b.c');
    expect(out).not.toMatch(/hunter2|abc\.def|Bearer x/);
  });
});

describe('sign-in tokens', () => {
  it('rejects tokens signed with another algorithm (e.g. "none")', () => {
    const forged = jwt.sign({ id: 'x', role: 'OWNER', email: 'e', schoolId: 's' }, '', { algorithm: 'none' });
    expect(() => verifyToken(forged)).toThrow();
    expect(verifyToken(signToken({ id: 'x', role: 'OWNER', email: 'e', schoolId: 's', sid: 'abc' }))).toMatchObject({ id: 'x', sid: 'abc' });
  });
});

describe('SQL injection guard', () => {
  // Prisma sends every value as a bound parameter. Raw SQL built from strings is the one way
  // to reintroduce injection, so application code may not use the "unsafe" raw APIs at all.
  it('application code never builds SQL from strings', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (/\$(query|execute)RawUnsafe|Prisma\.raw\(|\$(query|execute)Raw\(/.test(src)) offenders.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
