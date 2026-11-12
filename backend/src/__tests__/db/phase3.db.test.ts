/**
 * Phase 3 end-to-end: exams, marks entry, results, report cards, timetable.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/phase3
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(90_000);

d('Phase 3 API (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (role: string) => {
    const h = { Authorization: `Bearer ${tok[role]}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    };
  };
  const mathMarks = (records: object[], role = 'T_MATH', sectionId = ids.secA) =>
    as(role).put(`/exams/${ids.exam}/marks`, { sectionId, subjectId: ids.MATH, records });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('p3');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;
    const A = as('ADMIN');

    await A.put('/exams/grade-scale', { grades: [
      { grade: 'A+', minPercent: 90, maxPercent: 100 }, { grade: 'A', minPercent: 80, maxPercent: 89.99 },
      { grade: 'B', minPercent: 60, maxPercent: 79.99 }, { grade: 'C', minPercent: 40, maxPercent: 59.99 },
      { grade: 'F', minPercent: 0, maxPercent: 39.99 },
    ] });
    const cls = await A.post('/academics/classes', { name: 'Class 4', level: 4, sections: ['A', 'B'] });
    ids.class = cls.body.data.id;
    ids.secA = cls.body.data.sections.find((s: any) => s.name === 'A').id;
    ids.secB = cls.body.data.sections.find((s: any) => s.name === 'B').id;
    ids.MATH = (await A.post('/academics/subjects', { name: 'Mathematics', code: 'MATH' })).body.data.id;
    ids.ENG = (await A.post('/academics/subjects', { name: 'English', code: 'ENG' })).body.data.id;

    for (const key of ['T_MATH', 'T_ENG']) {
      const r = await A.post('/staff', { name: key, login: { email: `${key.toLowerCase()}.${t.code}@test.local` } });
      ids[key] = r.body.data.staff.id;
      tok[key] = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.login.user.id } }));
    }
    await A.put(`/academics/sections/${ids.secA}/subjects`, { assignments: [
      { subjectId: ids.MATH, teacherId: ids.T_MATH }, { subjectId: ids.ENG, teacherId: ids.T_ENG },
    ] });
    await request(app).patch(`/api/v1/academics/sections/${ids.secA}`).set({ Authorization: `Bearer ${tok.ADMIN}` }).send({ classTeacherId: ids.T_MATH });

    for (const [i, name] of ['Top Kid', 'Weak Maths', 'Absent Kid'].entries()) {
      const r = await A.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
        name, sectionId: ids.secA, rollNo: String(i + 1),
        guardians: [{ name: `Parent ${i}`, phone: `0300777000${i}`, relation: 'FATHER', ...(i === 0 ? { loginEmail: `p3parent.${t.code}@test.local` } : {}) }],
      });
      ids[`s${i}`] = r.body.data.student.id;
      if (i === 0) tok.PARENT = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.parentLogins[0].user.id } }));
    }
    const b = await A.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`, name: 'Section B Kid', sectionId: ids.secB, guardians: [{ name: 'B Parent', phone: '03007770009', relation: 'MOTHER' }] });
    ids.sB = b.body.data.student.id;
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
  });

  // ─── Setup & workflow ───

  it('rejects a grade scale with gaps', async () => {
    const r = await as('ADMIN').put('/exams/grade-scale', { grades: [{ grade: 'A', minPercent: 60, maxPercent: 100 }, { grade: 'F', minPercent: 0, maxPercent: 50 }] });
    expect(r.status).toBe(422);
  });

  it('office drafts an exam; drafts are hidden from parents and teachers', async () => {
    const r = await as('ADMIN').post('/exams', { name: 'Mid Term', startDate: '2026-12-01', endDate: '2026-12-05' });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('DRAFT');
    ids.exam = r.body.data.id;
    expect((await as('PARENT').get('/exams')).body.data).toHaveLength(0);
    expect((await as('T_MATH').get(`/exams/${ids.exam}`)).status).toBe(404);
    expect((await as('T_MATH').post('/exams', { name: 'Nope' })).status).toBe(403);
  });

  it('date sheet per class; passing marks cannot exceed total', async () => {
    const bad = await as('ADMIN').put(`/exams/${ids.exam}/classes/${ids.class}/subjects`, { subjects: [{ subjectId: ids.MATH, totalMarks: 50, passingMarks: 60 }] });
    expect(bad.status).toBe(422);
    const r = await as('ADMIN').put(`/exams/${ids.exam}/classes/${ids.class}/subjects`, { subjects: [
      { subjectId: ids.MATH, date: '2026-12-01', totalMarks: 100, passingMarks: 40, syllabus: 'Ch 1–5' },
      { subjectId: ids.ENG, date: '2026-12-02', totalMarks: 50, passingMarks: 20 },
    ] });
    expect(r.status).toBe(200);
    const exam = await as('ADMIN').get(`/exams/${ids.exam}`);
    expect(exam.body.data.classes[0]).toMatchObject({ name: 'Class 4', students: 4 });
    expect(exam.body.data.classes[0].subjects.map((s: any) => s.name)).toEqual(['Mathematics', 'English']);
  });

  it('marks are closed until the principal approves; only the principal approves', async () => {
    expect((await mathMarks([{ studentId: ids.s0, obtained: 90 }])).status).toBe(409);
    expect((await as('ADMIN').post(`/exams/${ids.exam}/approve`)).status).toBe(403);
    expect((await as('PRINCIPAL').post(`/exams/${ids.exam}/approve`)).status).toBe(200);
    expect((await as('PRINCIPAL').post(`/exams/${ids.exam}/approve`)).status).toBe(409);
    // Parents now see the schedule with syllabus, but no results yet.
    const fam = await as('PARENT').get(`/family/exams?studentId=${ids.s0}`);
    expect(fam.body.data[0]).toMatchObject({ name: 'Mid Term', status: 'SCHEDULED', result: null });
    expect(fam.body.data[0].papers[0]).toMatchObject({ subject: 'Mathematics', date: '2026-12-01', syllabus: 'Ch 1–5' });
  });

  // ─── Marks entry ───

  it('teachers enter marks only for subjects they teach in that section', async () => {
    const tasks = await as('T_MATH').get('/exams/marks/assignments');
    expect(tasks.body.data.map((x: any) => `${x.subject}/${x.section}`)).toEqual(['Mathematics/Class 4-A']);

    expect((await mathMarks([{ studentId: ids.s0, obtained: 101 }])).status).toBe(422);
    expect((await mathMarks([{ studentId: ids.sB, obtained: 50 }], 'T_MATH', ids.secB)).status).toBe(403);
    expect((await as('T_MATH').put(`/exams/${ids.exam}/marks`, { sectionId: ids.secA, subjectId: ids.ENG, records: [{ studentId: ids.s0, obtained: 40 }] })).status).toBe(403);
    expect((await mathMarks([{ studentId: ids.sB, obtained: 50 }])).status).toBe(422); // student from another section

    const ok = await mathMarks([
      { studentId: ids.s0, obtained: 90 }, { studentId: ids.s1, obtained: 35 }, { studentId: ids.s2, isAbsent: true },
    ]);
    expect(ok.body.data).toMatchObject({ saved: 3 });
    const eng = await as('T_ENG').put(`/exams/${ids.exam}/marks`, { sectionId: ids.secA, subjectId: ids.ENG, records: [
      { studentId: ids.s0, obtained: 45 }, { studentId: ids.s1, obtained: 30 }, { studentId: ids.s2, obtained: 40 },
    ] });
    expect(eng.status).toBe(200);

    const back = await as('T_MATH').get(`/exams/${ids.exam}/marks?sectionId=${ids.secA}&subjectId=${ids.MATH}`);
    expect(back.body.data.students.map((s: any) => [s.name, s.obtained, s.isAbsent])).toEqual([
      ['Top Kid', 90, false], ['Weak Maths', 35, false], ['Absent Kid', null, true],
    ]);
  });

  it('results: totals, grades, pass/fail and positions', async () => {
    const r = await as('T_MATH').get(`/exams/${ids.exam}/results?sectionId=${ids.secA}`);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.data.students.map((s: any) => [s.student.name, s]));
    expect(by['Top Kid']).toMatchObject({ obtained: 135, maxMarks: 150, percent: 90, grade: 'A+', passed: true, position: 1 });
    expect(by['Weak Maths']).toMatchObject({ percent: 43.33, grade: 'C', passed: false, failedSubjects: ['Mathematics'], position: 2 });
    expect(by['Absent Kid']).toMatchObject({ percent: 26.67, passed: false, position: 3 });
    expect((await as('PARENT').get(`/exams/${ids.exam}/results?sectionId=${ids.secA}`)).status).toBe(403);
  });

  it('only the class teacher (or office) writes report-card remarks', async () => {
    expect((await as('T_ENG').put(`/exams/${ids.exam}/remarks`, { sectionId: ids.secA, remarks: [{ studentId: ids.s0, remarks: 'x' }] })).status).toBe(403);
    const r = await as('T_MATH').put(`/exams/${ids.exam}/remarks`, { sectionId: ids.secA, remarks: [{ studentId: ids.s0, remarks: 'Excellent work, keep it up.' }] });
    expect(r.status).toBe(200);
  });

  // ─── Publishing & report cards ───

  it('parents cannot see the report card before publishing; staff can preview', async () => {
    expect((await as('PARENT').get(`/exams/${ids.exam}/report-card/${ids.s0}`)).status).toBe(404);
    const preview = await as('PRINCIPAL').get(`/exams/${ids.exam}/report-card/${ids.s0}`);
    expect(preview.body.data).toMatchObject({ remarks: 'Excellent work, keep it up.', rankedCount: 3, result: { position: 1 } });
  });

  it('publishing notifies families, locks marks, and opens report cards to parents', async () => {
    const pub = await as('PRINCIPAL').post(`/exams/${ids.exam}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.notified).toBe(1); // only Top Kid's parent has an app login
    const n = await as('PARENT').get('/notifications');
    expect(n.body.data.some((x: any) => x.type === 'RESULT_PUBLISHED')).toBe(true);

    expect((await mathMarks([{ studentId: ids.s1, obtained: 40 }])).status).toBe(409);

    const fam = await as('PARENT').get(`/family/exams?studentId=${ids.s0}`);
    expect(fam.body.data[0].result).toMatchObject({ percent: 90, grade: 'A+', position: 1, passed: true });

    const rc = await as('PARENT').get(`/exams/${ids.exam}/report-card/${ids.s0}`);
    expect(rc.status).toBe(200);
    expect(rc.body.data.classAverage).toBe(53.33);
    expect((await as('PARENT').get(`/exams/${ids.exam}/report-card/${ids.s1}`)).status).toBe(404);
  });

  it('report-card PDF via signed link; tampered links fail', async () => {
    const link = await as('PARENT').get(`/exams/${ids.exam}/report-card/${ids.s0}/pdf-link`);
    const url = new URL(link.body.data.url);
    const pdf = await request(app).get(url.pathname + url.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(1500);

    const other = url.pathname.replace(ids.s0, ids.s1);
    expect((await request(app).get(other + url.search)).status).toBe(403);
  });

  it('analysis for the class; principal can unpublish to correct marks', async () => {
    const a = await as('PRINCIPAL').get(`/exams/${ids.exam}/analysis?classId=${ids.class}`);
    expect(a.body.data).toMatchObject({ students: 4, resultsComplete: 3, passPercent: 33.3 });
    expect(a.body.data.subjects.find((s: any) => s.name === 'Mathematics')).toMatchObject({ entered: 3, highest: 90 });
    expect(a.body.data.toppers[0]).toMatchObject({ name: 'Top Kid', percent: 90 });
    expect((await as('T_MATH').get(`/exams/${ids.exam}/analysis?classId=${ids.class}`)).status).toBe(403);

    expect((await as('PRINCIPAL').post(`/exams/${ids.exam}/unpublish`)).status).toBe(200);
    expect((await mathMarks([{ studentId: ids.s1, obtained: 40 }])).status).toBe(200);
    expect((await as('PARENT').get(`/exams/${ids.exam}/report-card/${ids.s0}`)).status).toBe(404);
  });

  // ─── Timetable ───

  it('timetable: save, read by role, and reject teacher clashes', async () => {
    const A = as('ADMIN');
    const saved = await A.put(`/timetable/section/${ids.secA}`, { slots: [
      { dayOfWeek: 'MONDAY', period: 1, startTime: '08:00', endTime: '08:40', subjectId: ids.MATH, teacherId: ids.T_MATH },
      { dayOfWeek: 'MONDAY', period: 2, startTime: '08:40', endTime: '09:20', subjectId: ids.ENG, teacherId: ids.T_ENG, room: '12' },
    ] });
    expect(saved.body.data).toMatchObject({ saved: 2 });

    const clash = await A.put(`/timetable/section/${ids.secB}`, { slots: [
      { dayOfWeek: 'MONDAY', period: 1, startTime: '08:20', endTime: '09:00', subjectId: ids.MATH, teacherId: ids.T_MATH },
    ] });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/T_MATH already teaches Class 4-A/);

    const overlap = await A.put(`/timetable/section/${ids.secB}`, { slots: [
      { dayOfWeek: 'TUESDAY', period: 1, startTime: '08:00', endTime: '09:00', subjectId: ids.MATH, teacherId: ids.T_ENG },
      { dayOfWeek: 'TUESDAY', period: 2, startTime: '08:30', endTime: '09:30', subjectId: ids.ENG, teacherId: ids.T_ENG },
    ] });
    expect(overlap.status).toBe(422);

    expect((await as('PARENT').get(`/timetable/section/${ids.secA}`)).body.data).toHaveLength(2);
    expect((await as('PARENT').get(`/timetable/section/${ids.secB}`)).status).toBe(404);
    const mine = await as('T_ENG').get('/timetable/teacher/me');
    expect(mine.body.data.map((s: any) => [s.subject.name, s.section.name, s.room])).toEqual([['English', 'Class 4-A', '12']]);
    expect((await as('T_ENG').get(`/timetable/teacher/${ids.T_MATH}`)).status).toBe(403);
    expect((await as('T_MATH').put(`/timetable/section/${ids.secA}`, { slots: [] })).status).toBe(403);
  });
});
