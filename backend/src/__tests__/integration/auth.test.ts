import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../app';

// Mock Prisma and Redis for integration tests
jest.mock('../../config/database', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    school: { findUnique: jest.fn() },
  };
  return { __esModule: true, default: mockPrisma, basePrisma: mockPrisma };
});

jest.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }),
}));

import prisma from '../../config/database';

const mockPrisma = prisma as any;

describe('POST /api/v1/auth/login', () => {
  const hashedPassword = bcrypt.hashSync('ValidPass@1', 10);

  const mockUser = {
    id: 'user-1',
    name: 'Admin User',
    email: 'admin@test.com',
    password: hashedPassword,
    role: 'ADMIN',
    schoolId: 'school-1',
    isActive: true,
    mfaEnabled: false,
    avatar: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ ...mockUser, school: { id: 'school-1', name: 'Test School' } });
    mockPrisma.user.update.mockResolvedValue(mockUser);
    mockPrisma.school.findUnique.mockResolvedValue({ isActive: true });
  });

  it('returns 200 with tokens on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'ValidPass@1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.user.email).toBe('admin@test.com');
  });

  it('returns 422 on invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'ValidPass@1' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid credentials/i);
  });

  it('returns 401 when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.com', password: 'ValidPass@1' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the school is suspended', async () => {
    mockPrisma.school.findUnique.mockResolvedValue({ isActive: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'ValidPass@1' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });

  it('returns 403 when the user is disabled', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'ValidPass@1' });

    expect(res.status).toBe(403);
  });

  it('puts schoolId in the access token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'ValidPass@1' });

    const claims = JSON.parse(Buffer.from(res.body.data.accessToken.split('.')[1], 'base64url').toString());
    expect(claims.schoolId).toBe('school-1');
  });
});

describe('POST /api/v1/auth/register', () => {
  it('is no longer public: accounts are created by school staff', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: 'ValidPass@1', role: 'ADMIN' });

    expect(res.status).toBe(404);
  });
});
