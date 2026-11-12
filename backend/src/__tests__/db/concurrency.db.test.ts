/**
 * Regression: concurrent writes from different schools to the same unique index
 * (subject teachers, attendance) used to deadlock in InnoDB and fail one request.
 * Writes now go through `transaction()`, which retries deadlocked transactions.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/concurrency
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma, isRetryableTxError } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('isRetryableTxError', () => {
  it('recognises deadlocks and write conflicts only', () => {
    expect(isRetryableTxError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTxError({ message: 'Deadlock found when trying to get lock' })).toBe(true);
    expect(isRetryableTxError({ code: 'P2002' })).toBe(false);
    expect(isRetryableTxError(new Error('Validation failed'))).toBe(false);
  });
});

d('concurrent writes across schools (database)', () => {
  const schools: { t: Awaited<ReturnType<typeof createTestSchool>>; admin: string; sections: string[]; subject: string; teacher: string; students: string[] }[] = [];

  beforeAll(async () => {
    await connectRedis();
    for (const name of ['cc1', 'cc2']) {
      const t = await createTestSchool(name);
      const admin = (await t.user('ADMIN')).token;
      const h = { Authorization: `Bearer ${admin}` };
      const cls = await request(app).post('/api/v1/academics/classes').set(h).send({ name: 'Class 1', level: 1, sections: ['A', 'B', 'C', 'D'] });
      const subj = await request(app).post('/api/v1/academics/subjects').set(h).send({ name: 'Maths', code: 'MATH' });
      const st = await request(app).post('/api/v1/staff').set(h).send({ name: 'Concurrent Teacher' });
      const students: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await request(app).post('/api/v1/students').set(h).send({ admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
          name: `Kid ${i}`, sectionId: cls.body.data.sections[0].id, guardians: [{ name: `Parent ${i}`, phone: `0300${name}${i}000`.slice(0, 11), relation: 'FATHER' }],
        });
        students.push(r.body.data.student.id);
      }
      schools.push({ t, admin, sections: cls.body.data.sections.map((s: any) => s.id), subject: subj.body.data.id, teacher: st.body.data.staff.id, students });
    }
  });

  afterAll(async () => {
    for (const s of schools) await s.t.destroy();
    await basePrisma.$disconnect();
  });

  it('parallel subject-teacher saves in two schools all succeed', async () => {
    const calls = schools.flatMap((s) => [1, 2, 3].flatMap(() => s.sections.map((sectionId) =>
      request(app).put(`/api/v1/academics/sections/${sectionId}/subjects`).set({ Authorization: `Bearer ${s.admin}` })
        .send({ assignments: [{ subjectId: s.subject, teacherId: s.teacher }] }))));
    const results = await Promise.all(calls);
    expect(results.map((r) => r.status).filter((st) => st !== 200)).toEqual([]);
    for (const s of schools) {
      expect(await basePrisma.subjectAssignment.count({ where: { schoolId: s.t.school.id } })).toBe(s.sections.length);
    }
  });

  it('parallel attendance saves in two schools all succeed', async () => {
    const calls = schools.flatMap((s) => [1, 2, 3, 4].map((n) =>
      request(app).put('/api/v1/attendance/students').set({ Authorization: `Bearer ${s.admin}` })
        .send({ sectionId: s.sections[0], records: s.students.map((studentId, i) => ({ studentId, status: (i + n) % 3 ? 'PRESENT' : 'ABSENT' })) })));
    const results = await Promise.all(calls);
    expect(results.map((r) => r.status).filter((st) => st !== 200)).toEqual([]);
  });
});

