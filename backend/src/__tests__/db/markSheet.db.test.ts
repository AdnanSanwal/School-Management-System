/**
 * CR-07 Marks entry dashboard: section sheet, draft → submit → reopen, retake rule, teacher scope.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/markSheet.db.test.ts
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(90_000);

d('Marks sheet API (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const paper: Record<string, string> = {}; // subject code → examSubjectId

  const as = (role: string) => {
    const h = { Authorization: `Bearer ${tok[role]}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
    };
  };
  const sheet = (role = 'ADMIN', sectionId = ids.secA) => as(role).get(`/exams/${ids.exam}/sheet?sectionId=${sectionId}`);
  const e = (s: string, code: string, obtained: number | null, isAbsent = false) => ({ studentId: ids[s], examSubjectId: paper[code], obtained, isAbsent });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('ms');
    for (const r of ['PRINCIPAL', 'ADMIN'] as const) tok[r] = (await t.user(r)).token;
    const A = as('ADMIN');
    await A.put('/exams/grade-scale', { grades: [
      { grade: 'A', minPercent: 80, maxPercent: 100 }, { grade: 'B', minPercent: 50, maxPercent: 79.99 }, { grade: 'F', minPercent: 0, maxPercent: 49.99 },
    ] });
    const cls = await A.post('/academics/classes', { name: 'Class 5', level: 5, sections: ['A', 'B'] });
    ids.class = cls.body.data.id;
    ids.secA = cls.body.data.sections.find((s: any) => s.name === 'A').id;
    ids.secB = cls.body.data.sections.find((s: any) => s.name === 'B').id;
    for (const code of ['MATH', 'ENG', 'SCI']) ids[code] = (await A.post('/academics/subjects', { name: code, code })).body.data.id;

    const r = await A.post('/staff', { name: 'T_MATH', login: { email: `t_math.${t.code}@test.local` } });
    ids.T_MATH = r.body.data.staff.id;
    tok.T_MATH = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.login.user.id } }));
    await A.put(`/academics/sections/${ids.secA}/subjects`, { assignments: [{ subjectId: ids.MATH, teacherId: ids.T_MATH }] });

    for (const [i, name] of ['Passer', 'Retaker', 'Failer'].entries()) {
      const s = await A.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`, name, sectionId: ids.secA, rollNo: String(i + 1), guardians: [{ name: `G ${i}`, phone: `0300888000${i}`, relation: 'FATHER' }] });
      ids[`s${i}`] = s.body.data.student.id;
    }

    ids.exam = (await A.post('/exams', { name: 'Mid Term' })).body.data.id;
    await A.put(`/exams/${ids.exam}/classes/${ids.class}/subjects`, { subjects: [
      { subjectId: ids.MATH, totalMarks: 100, passingMarks: 40 },
      { subjectId: ids.ENG, totalMarks: 50, passingMarks: 20 },
      { subjectId: ids.SCI, totalMarks: 100, passingMarks: 40 },
    ] });
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
  });

  it('draft exams: managers can load the sheet but not save; teachers cannot see it', async () => {
    const r = await sheet();
    expect(r.status).toBe(200);
    expect(r.body.data.permissions).toMatchObject({ canEdit: false });
    expect((await as('ADMIN').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [] })).status).toBe(409);
    expect((await sheet('T_MATH')).status).toBe(404);
    await as('PRINCIPAL').post(`/exams/${ids.exam}/approve`);
  });

  it('options list the exam with the sections each user may load', async () => {
    const admin = await as('ADMIN').get('/exams/marks/options');
    expect(admin.status).toBe(200);
    expect(admin.body.data.retakeMaxSubjects).toBe(2);
    const ex = admin.body.data.exams.find((x: any) => x.id === ids.exam);
    expect(ex.classes[0].sections.map((s: any) => s.name)).toEqual(['A', 'B']);
    const teacher = await as('T_MATH').get('/exams/marks/options');
    expect(teacher.body.data.exams.find((x: any) => x.id === ids.exam).classes[0].sections.map((s: any) => s.name)).toEqual(['A']);
  });

  it('loads the sheet with one column per subject and its max marks', async () => {
    const r = await sheet();
    expect(r.status).toBe(200);
    const d = r.body.data;
    for (const s of d.subjects) paper[s.name] = s.id;
    expect(d.subjects.map((s: any) => [s.name, s.totalMarks])).toEqual(expect.arrayContaining([['MATH', 100], ['ENG', 50], ['SCI', 100]]));
    expect(d.students).toHaveLength(3);
    expect(d.sheet.status).toBe('DRAFT');
    expect(d.permissions.canEdit).toBe(true);
  });

  it('teachers only load sections and edit subjects they teach', async () => {
    expect((await sheet('T_MATH', ids.secB)).status).toBe(403);
    const r = await sheet('T_MATH');
    expect(r.status).toBe(200);
    expect(r.body.data.subjects.filter((s: any) => s.editable).map((s: any) => s.name)).toEqual(['MATH']);
    const bad = await as('T_MATH').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'ENG', 30)] });
    expect(bad.status).toBe(403);
    const ok = await as('T_MATH').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'MATH', 90)] });
    expect(ok.status).toBe(200);
  });

  it('validates marks on the server', async () => {
    const over = await as('ADMIN').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'ENG', 51)] });
    expect(over.status).toBe(422);
    expect(over.body.message).toMatch(/between 0 and 50/);
    expect((await as('ADMIN').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'ENG', -1)] })).status).toBe(422);
    expect((await as('ADMIN').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [{ ...e('s0', 'ENG', 0), obtained: 'abc' }] })).status).toBe(422);
  });

  it('submit refuses an incomplete sheet', async () => {
    const r = await as('ADMIN').post(`/exams/${ids.exam}/sheet/submit`, { sectionId: ids.secA });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/missing/);
  });

  it('saves a draft with remarks and applies the retake rule', async () => {
    const r = await as('ADMIN').put(`/exams/${ids.exam}/sheet`, {
      sectionId: ids.secA, remarks: 'Checked twice',
      entries: [
        e('s0', 'MATH', 90), e('s0', 'ENG', 45), e('s0', 'SCI', 80),
        e('s1', 'MATH', 10), e('s1', 'ENG', 40), e('s1', 'SCI', 80),
        e('s2', 'MATH', 10), e('s2', 'ENG', 5), e('s2', 'SCI', null, true),
      ],
    });
    expect(r.status).toBe(200);
    const d = (await sheet()).body.data;
    expect(d.sheet).toMatchObject({ status: 'DRAFT', remarks: 'Checked twice' });
    const by = Object.fromEntries(d.students.map((s: any) => [s.name, s]));
    expect(by.Passer).toMatchObject({ total: 215, outcome: 'PASS', grade: 'A' });
    expect(by.Retaker.outcome).toBe('RETAKE');
    expect(by.Failer.outcome).toBe('FAIL');
    expect(d.summary).toMatchObject({ passed: 1, retake: 1, failed: 1, pending: 0 });
  });

  it('the retake limit is a school setting changed by exam managers', async () => {
    expect((await as('T_MATH').patch('/exams/marks/settings', { retakeMaxSubjects: 3 })).status).toBe(403);
    expect((await as('ADMIN').patch('/exams/marks/settings', { retakeMaxSubjects: -1 })).status).toBe(422);
    expect((await as('ADMIN').patch('/exams/marks/settings', { retakeMaxSubjects: 3 })).status).toBe(200);
    expect((await sheet()).body.data.summary).toMatchObject({ passed: 1, retake: 2, failed: 0 });
    await as('ADMIN').patch('/exams/marks/settings', { retakeMaxSubjects: 2 });
  });

  it('submit locks the sheet for teachers and is written to the activity log', async () => {
    const r = await as('T_MATH').post(`/exams/${ids.exam}/sheet/submit`, { sectionId: ids.secA, entries: [e('s0', 'MATH', 95)] });
    expect(r.status).toBe(200);
    const d = (await sheet('T_MATH')).body.data;
    expect(d.sheet.status).toBe('SUBMITTED');
    expect(d.sheet.submittedBy).toMatch(/T_MATH/);
    expect(d.permissions).toMatchObject({ canEdit: false, canReopen: false });
    expect((await as('T_MATH').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'MATH', 50)] })).status).toBe(409);
    // The per-subject endpoint respects the lock too.
    expect((await as('T_MATH').put(`/exams/${ids.exam}/marks`, { sectionId: ids.secA, subjectId: ids.MATH, records: [{ studentId: ids.s0, obtained: 50 }] })).status).toBe(409);
    expect((await sheet('ADMIN')).body.data.permissions.canReopen).toBe(true);
    const log = await basePrisma.auditLog.findFirst({ where: { schoolId: t.school.id, action: 'Marks submitted' } });
    expect(log?.entityId).toBe(d.sheet.id);
  });

  it('only exam managers reopen; reopening returns the sheet to draft and is logged', async () => {
    expect((await as('T_MATH').post(`/exams/${ids.exam}/sheet/reopen`, { sectionId: ids.secA })).status).toBe(403);
    const r = await as('PRINCIPAL').post(`/exams/${ids.exam}/sheet/reopen`, { sectionId: ids.secA });
    expect(r.status).toBe(200);
    expect((await sheet()).body.data.sheet.status).toBe('DRAFT');
    expect((await as('PRINCIPAL').post(`/exams/${ids.exam}/sheet/reopen`, { sectionId: ids.secA })).status).toBe(409);
    expect(await basePrisma.auditLog.count({ where: { schoolId: t.school.id, action: 'Marks reopened' } })).toBe(1);
    expect((await as('T_MATH').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'MATH', 50)] })).status).toBe(200);
  });

  it('clearing a mark removes it', async () => {
    await as('ADMIN').put(`/exams/${ids.exam}/sheet`, { sectionId: ids.secA, entries: [e('s0', 'MATH', null)] });
    const d = (await sheet()).body.data;
    const s0 = d.students.find((s: any) => s.id === ids.s0);
    expect(s0.marks[paper.MATH]).toEqual({ obtained: null, isAbsent: false });
    expect(s0.outcome).toBeNull();
  });
});
