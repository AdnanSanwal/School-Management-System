/**
 * Test maker: the question bank (chapters, topics, six question types, English and Urdu,
 * pictures, bulk import) and papers drawn from it.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/testmaker
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { spreadPick, totalMarks } from '../../modules/testmaker/testmaker.routes';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(180_000);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('paper arithmetic', () => {
  it('draws in turns from each chapter, never the same question twice', () => {
    const pool = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, chapterId: 'A' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, chapterId: 'B' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, chapterId: 'C' })),
    ];
    const six = spreadPick(pool, 6);
    expect(new Set(six.map((q) => q.id)).size).toBe(6);
    // Two from each chapter, although chapter A holds most of the questions.
    expect(['A', 'B', 'C'].map((c) => six.filter((q) => q.chapterId === c).length)).toEqual([2, 2, 2]);
    // More than the small chapters hold: the rest comes from the big one.
    const twelve = spreadPick(pool, 12);
    expect(['A', 'B', 'C'].map((c) => twelve.filter((q) => q.chapterId === c).length)).toEqual([6, 3, 3]);
    // More than there are: everything, once.
    expect(spreadPick(pool, 99)).toHaveLength(26);
  });

  it('adds up marks; "attempt any N" counts N questions', () => {
    expect(totalMarks([{ items: [{ marks: 1 }, { marks: 1 }, { marks: 1 }] }, { items: [{ marks: 5 }, { marks: 5 }] }])).toBe(13);
    expect(totalMarks([{ attempt: 2, items: [{ marks: 5 }, { marks: 5 }, { marks: 5 }] }])).toBe(10);
    expect(totalMarks([{ attempt: 5, items: [{ marks: 2 }, { marks: 2 }] }])).toBe(4); // asking for more than there are changes nothing
  });
});

d('Test maker (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  type TestUser = Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>;
  const u: Record<string, TestUser> = {};
  const ids: Record<string, string> = {};

  const api = (who: TestUser) => {
    const h = { Authorization: `Bearer ${who.token}` };
    return {
      get: (url: string) => request(app).get(`/api/v1/testmaker${url}`).set(h),
      post: (url: string, body: object = {}) => request(app).post(`/api/v1/testmaker${url}`).set(h).send(body),
      put: (url: string, body: object = {}) => request(app).put(`/api/v1/testmaker${url}`).set(h).send(body),
      patch: (url: string, body: object = {}) => request(app).patch(`/api/v1/testmaker${url}`).set(h).send(body),
      del: (url: string) => request(app).delete(`/api/v1/testmaker${url}`).set(h).send({}),
      upload: (url: string, file: Buffer, filename: string) => request(app).post(`/api/v1/testmaker${url}`).set(h).attach('file', file, filename),
    };
  };
  const maths = () => `classId=${ids.cls}&subjectId=${ids.maths}`;
  const mcq = (n: number, extra: object = {}) => ({
    type: 'MCQ', textEn: `What is ${n} + ${n}?`, options: [{ en: `${n * 2}` }, { en: `${n * 2 + 1}` }, { en: `${n}` }, { en: '0' }], answer: { index: 0 }, marks: 1, ...extra,
  });
  const add = async (who: TestUser, chapterId: string, body: object) => {
    const res = await api(who).post('/questions', { chapterId, ...body });
    expect(res.status).toBe(201);
    return res.body.data;
  };

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('tm');
    other = await createTestSchool('tm-other');
    for (const role of ['PRINCIPAL', 'ADMIN', 'TEACHER', 'PARENT'] as const) u[role] = await t.user(role);
    u.otherTeacher = await t.user('TEACHER', 'teacher2');
    u.outsider = await other.user('PRINCIPAL', 'outsider');

    const cls = await basePrisma.class.create({ data: { schoolId: t.school.id, name: 'Class 9', level: 9 } });
    const section = await basePrisma.section.create({ data: { schoolId: t.school.id, classId: cls.id, name: 'A' } });
    const maths = await basePrisma.subject.create({ data: { schoolId: t.school.id, name: 'Mathematics', code: 'MATH' } });
    const urdu = await basePrisma.subject.create({ data: { schoolId: t.school.id, name: 'Urdu', code: 'URD' } });
    // The teacher teaches maths to 9-A. The second teacher teaches nothing yet.
    const staff = await basePrisma.staff.create({ data: { schoolId: t.school.id, employeeNo: 'E1', name: 'Maths teacher', userId: u.TEACHER.id } });
    await basePrisma.subjectAssignment.create({ data: { schoolId: t.school.id, academicYearId: t.year.id, sectionId: section.id, subjectId: maths.id, teacherId: staff.id } });
    await basePrisma.staff.create({ data: { schoolId: t.school.id, employeeNo: 'E2', name: 'Second teacher', userId: u.otherTeacher.id } });
    Object.assign(ids, { cls: cls.id, maths: maths.id, urdu: urdu.id });
  });
  afterAll(async () => {
    await fs.rm(path.join(process.env.UPLOAD_DIR || 'uploads', t.school.id), { recursive: true, force: true }).catch(() => {});
    await t.destroy();
    await other.destroy();
  });

  // ─── Who ───

  it('office staff work on everything; a teacher only on what they teach; families not at all', async () => {
    expect((await api(u.PARENT).get('/scope')).status).toBe(403);
    expect((await api(u.PRINCIPAL).get('/scope')).body.data).toMatchObject({ pairs: null });
    const mine = (await api(u.TEACHER).get('/scope')).body.data;
    expect(mine.pairs).toEqual([{ classId: ids.cls, subjectId: ids.maths }]);
    expect(mine.subjects.map((s: any) => s.name)).toEqual(['Mathematics']);

    expect((await api(u.TEACHER).get(`/chapters?${maths()}`)).status).toBe(200);
    expect((await api(u.TEACHER).get(`/chapters?classId=${ids.cls}&subjectId=${ids.urdu}`)).status).toBe(403);
    expect((await api(u.otherTeacher).get(`/chapters?${maths()}`)).status).toBe(403);
    expect((await api(u.otherTeacher).post('/chapters', { classId: ids.cls, subjectId: ids.maths, number: 9, name: 'Sneaky' })).status).toBe(403);
  });

  // ─── Chapters and topics ───

  it('chapters are numbered within a class and subject, and hold topics', async () => {
    const ch1 = await api(u.TEACHER).post('/chapters', { classId: ids.cls, subjectId: ids.maths, number: 1, name: 'Real numbers', nameUr: 'حقیقی اعداد' });
    expect(ch1.status).toBe(201);
    expect((await api(u.TEACHER).post('/chapters', { classId: ids.cls, subjectId: ids.maths, number: 1, name: 'Again' })).status).toBe(409);
    const ch2 = await api(u.ADMIN).post('/chapters', { classId: ids.cls, subjectId: ids.maths, number: 2, name: 'Logarithms' });
    const ch3 = await api(u.ADMIN).post('/chapters', { classId: ids.cls, subjectId: ids.maths, number: 3, name: 'Algebra' });
    const topic = await api(u.TEACHER).post(`/chapters/${ch1.body.data.id}/topics`, { name: 'Rational numbers' });
    Object.assign(ids, { ch1: ch1.body.data.id, ch2: ch2.body.data.id, ch3: ch3.body.data.id, topic: topic.body.data.id });

    const list = (await api(u.TEACHER).get(`/chapters?${maths()}`)).body.data;
    expect(list.map((c: any) => [c.number, c.name, c.questions])).toEqual([[1, 'Real numbers', 0], [2, 'Logarithms', 0], [3, 'Algebra', 0]]);
    expect(list[0]).toMatchObject({ nameUr: 'حقیقی اعداد', topics: [{ name: 'Rational numbers' }] });
    // The same chapter number is free in another subject.
    expect((await api(u.ADMIN).post('/chapters', { classId: ids.cls, subjectId: ids.urdu, number: 1, name: 'نظم' })).status).toBe(201);
  });

  // ─── Questions ───

  it('takes all six types, in English, Urdu or both', async () => {
    const q1 = await add(u.TEACHER, ids.ch1, { ...mcq(2), topicId: ids.topic, textUr: '۲ + ۲ کتنے ہوتے ہیں؟', source: 'EXERCISE' });
    expect(q1).toMatchObject({ type: 'MCQ', classId: ids.cls, subjectId: ids.maths, answer: { index: 0 }, source: 'EXERCISE', imageUrl: null });
    ids.q1 = q1.id;
    await add(u.TEACHER, ids.ch1, { type: 'TRUE_FALSE', textEn: 'Zero is a natural number.', answer: { value: false } });
    await add(u.TEACHER, ids.ch1, { type: 'BLANK', textEn: 'The square root of 49 is ____.', answer: { en: '7' } });
    await add(u.TEACHER, ids.ch1, { type: 'SHORT', textUr: 'ناطق اعداد کی تعریف کریں۔', marks: 2 }); // Urdu only, no model answer
    await add(u.TEACHER, ids.ch1, { type: 'LONG', textEn: 'Prove that √2 is irrational.', marks: 8, answer: { en: 'Assume it is rational…' } });
    const match = await add(u.TEACHER, ids.ch1, {
      type: 'MATCH', textEn: 'Match each number with its kind.',
      options: [{ left: { en: '7' }, right: { en: 'Prime' } }, { left: { en: '8' }, right: { en: 'Even', ur: 'جفت' } }],
    });
    expect(match.options).toHaveLength(2);
    expect((await api(u.TEACHER).get(`/questions/counts?${maths()}&chapterIds=${ids.ch1}`)).body.data)
      .toEqual({ MCQ: 1, TRUE_FALSE: 1, BLANK: 1, SHORT: 1, LONG: 1, MATCH: 1 });
  });

  it('refuses a question that cannot be printed or marked', async () => {
    const bad = async (body: object) => (await api(u.TEACHER).post('/questions', { chapterId: ids.ch1, ...body })).status;
    expect(await bad({ type: 'SHORT' })).toBe(422); // no words at all
    expect(await bad({ type: 'MCQ', textEn: 'Pick one', options: [{ en: 'only one' }], answer: { index: 0 } })).toBe(422);
    expect(await bad({ type: 'MCQ', textEn: 'Pick one', options: [{ en: 'a' }, { en: 'b' }] })).toBe(422); // no correct choice
    expect(await bad({ type: 'MCQ', textEn: 'Pick one', options: [{ en: 'a' }, { en: 'b' }], answer: { index: 5 } })).toBe(422);
    expect(await bad({ type: 'MCQ', textEn: 'Pick one', options: [{ en: 'a' }, {}], answer: { index: 0 } })).toBe(422); // an empty choice
    expect(await bad({ type: 'TRUE_FALSE', textEn: 'Statement' })).toBe(422);
    expect(await bad({ type: 'MATCH', options: [{ left: { en: 'a' }, right: {} }, { left: { en: 'b' }, right: { en: 'c' } }] })).toBe(422);
    expect(await bad({ type: 'SHORT', textEn: 'Fine', marks: 0 })).toBe(422);
    expect(await bad({ type: 'SHORT', textEn: 'Fine', topicId: ids.topic, chapterId: ids.ch2 })).toBe(422); // topic of another chapter
    expect((await api(u.TEACHER).post('/questions', { chapterId: '00000000-0000-4000-8000-000000000000', type: 'SHORT', textEn: 'x' })).status).toBe(404);
  });

  it('lists with filters and search; only the author or the office may change one', async () => {
    const all = await api(u.TEACHER).get(`/questions?${maths()}`);
    expect(all.body.meta?.total ?? all.body.pagination?.total ?? all.body.data.length).toBe(6);
    expect((await api(u.TEACHER).get(`/questions?${maths()}&type=MCQ`)).body.data).toHaveLength(1);
    expect((await api(u.TEACHER).get(`/questions?${maths()}&topicId=${ids.topic}`)).body.data).toHaveLength(1);
    expect((await api(u.TEACHER).get(`/questions?${maths()}&search=irrational`)).body.data.map((q: any) => q.type)).toEqual(['LONG']);
    expect((await api(u.TEACHER).get(`/questions?${maths()}&search=${encodeURIComponent('ناطق')}`)).body.data.map((q: any) => q.type)).toEqual(['SHORT']);

    // A teacher who now also teaches this class cannot rewrite a colleague's question; the office can.
    const staff2 = await basePrisma.staff.findFirstOrThrow({ where: { userId: u.otherTeacher.id } });
    const section = await basePrisma.section.findFirstOrThrow({ where: { classId: ids.cls } });
    await basePrisma.subjectAssignment.create({ data: { schoolId: t.school.id, academicYearId: t.year.id, sectionId: section.id, subjectId: ids.urdu, teacherId: staff2.id } });
    expect((await api(u.otherTeacher).patch(`/questions/${ids.q1}`, mcq(3))).status).toBe(403);
    // An edit replaces the whole question: the Urdu wording is dropped here because it was not sent.
    const edited = await api(u.PRINCIPAL).patch(`/questions/${ids.q1}`, { ...mcq(3), marks: 2, topicId: ids.topic });
    expect(edited.body.data).toMatchObject({ textEn: 'What is 3 + 3?', textUr: null });
    expect(Number(edited.body.data.marks)).toBe(2);
    expect((await api(u.outsider).patch(`/questions/${ids.q1}`, mcq(4))).status).toBe(404);
  });

  it('imports many at once, or none if any row is wrong', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => mcq(i + 10));
    const broken = await api(u.TEACHER).post('/questions/import', { chapterId: ids.ch2, rows: [...rows, { type: 'MCQ', textEn: 'No choices' }, { type: 'NOPE', textEn: 'x' }] });
    expect(broken.status).toBe(422);
    expect(broken.body.errors.map((e: any) => e.row)).toEqual([13, 14]);
    expect(await basePrisma.question.count({ where: { chapterId: ids.ch2 } })).toBe(0);

    const ok = await api(u.TEACHER).post('/questions/import', { chapterId: ids.ch2, rows });
    expect(ok.body.data).toEqual({ created: 12 });
    await api(u.ADMIN).post('/questions/import', { chapterId: ids.ch3, rows: Array.from({ length: 4 }, (_, i) => mcq(i + 50)) });
    await api(u.ADMIN).post('/questions/import', { chapterId: ids.ch2, rows: Array.from({ length: 5 }, (_, i) => ({ type: 'SHORT', textEn: `Define term ${i}.`, marks: 2 })) });
    // A chapter with questions cannot be deleted by accident.
    expect((await api(u.ADMIN).del(`/chapters/${ids.ch2}`)).status).toBe(409);
  });

  it('a question can carry a picture', async () => {
    expect((await api(u.otherTeacher).upload(`/questions/${ids.q1}/image`, PNG, 'fig.png')).status).toBe(403); // does not teach this subject
    expect((await api(u.PRINCIPAL).upload(`/questions/${ids.q1}/image`, Buffer.from('%PDF-1.4 not a picture'), 'fig.png')).status).toBeGreaterThanOrEqual(400);
    const res = await api(u.PRINCIPAL).upload(`/questions/${ids.q1}/image`, PNG, 'fig.png');
    expect(res.status).toBe(200);
    expect(res.body.data.imageKey).toMatch(new RegExp(`^${t.school.id}/questions/`));
    expect(res.body.data.imageUrl).toContain('/api/v1/files/');
    ids.q1Image = res.body.data.imageKey;
    // The signed link serves the picture.
    const url = new URL(res.body.data.imageUrl);
    expect((await request(app).get(url.pathname + url.search)).status).toBe(200);
  });

  // ─── Papers ───

  describe('papers', () => {
    const draw = (who: TestUser, body: object) => api(who).post('/papers/draw', { classId: ids.cls, subjectId: ids.maths, ...body });
    let paperId = '';

    it('draws the mix asked for, spread over the chosen chapters, and says where the bank falls short', async () => {
      const res = await draw(u.TEACHER, {
        chapterIds: [ids.ch1, ids.ch2, ids.ch3],
        mix: [{ type: 'MCQ', count: 9, marksEach: 1 }, { type: 'SHORT', count: 4, marksEach: 3 }, { type: 'LONG', count: 3 }],
      });
      expect(res.status).toBe(200);
      const [mcqs, shorts, longs] = res.body.data.sections;
      expect(mcqs).toMatchObject({ type: 'MCQ', title: 'Multiple choice questions', titleUr: 'کثیر الانتخابی سوالات' });
      expect(mcqs.items).toHaveLength(9);
      expect(new Set(mcqs.items.map((i: any) => i.questionId)).size).toBe(9);
      // Chapter 1 has one MCQ, chapter 3 has four, chapter 2 has twelve: all three are represented.
      const chapterOf = new Map((await basePrisma.question.findMany({ where: { schoolId: t.school.id }, select: { id: true, chapterId: true } })).map((q) => [q.id, q.chapterId]));
      const perChapter = (c: string) => mcqs.items.filter((i: any) => chapterOf.get(i.questionId) === c).length;
      expect([perChapter(ids.ch1), perChapter(ids.ch3), perChapter(ids.ch2)]).toEqual([1, 4, 4]);
      expect(shorts.items.every((i: any) => i.marks === 3)).toBe(true); // marks set for this paper
      expect(longs.items[0].marks).toBe(8); // otherwise the question's own marks
      // The bank has one long question; three were asked for.
      expect(res.body.data.short).toEqual([{ type: 'LONG', wanted: 3, available: 1 }]);
    });

    it('a replacement never repeats what is already on the paper; chapters and topics narrow the draw', async () => {
      const first = (await draw(u.TEACHER, { chapterIds: [ids.ch2], mix: [{ type: 'MCQ', count: 11 }] })).body.data.sections[0].items.map((i: any) => i.questionId);
      const swap = await draw(u.TEACHER, { chapterIds: [ids.ch2], mix: [{ type: 'MCQ', count: 1 }], excludeIds: first });
      expect(swap.body.data.sections[0].items).toHaveLength(1);
      expect(first).not.toContain(swap.body.data.sections[0].items[0].questionId);
      const none = await draw(u.TEACHER, { chapterIds: [ids.ch2], mix: [{ type: 'MCQ', count: 1 }], excludeIds: [...first, swap.body.data.sections[0].items[0].questionId] });
      expect(none.body.data.short).toEqual([{ type: 'MCQ', wanted: 1, available: 0 }]);

      const topicOnly = await draw(u.TEACHER, { chapterIds: [ids.ch1, ids.ch2], topicIds: [ids.topic], mix: [{ type: 'MCQ', count: 5 }] });
      expect(topicOnly.body.data.sections[0].items.map((i: any) => i.questionId)).toEqual([ids.q1]);
      expect((await draw(u.otherTeacher, { chapterIds: [ids.ch1], mix: [{ type: 'MCQ', count: 1 }] })).status).toBe(403);
    });

    it('saves a paper with its own copy of every question, and adds up the marks', async () => {
      const drawn = (await draw(u.TEACHER, {
        chapterIds: [ids.ch1, ids.ch2],
        mix: [{ type: 'MCQ', count: 5, marksEach: 1 }, { type: 'SHORT', count: 5, marksEach: 2 }, { type: 'MATCH', count: 1, marksEach: 4 }],
      })).body.data.sections;
      // Make sure the pictured question is on the paper, and let pupils attempt any 3 of the 5 short questions.
      const pictured = (await draw(u.TEACHER, { chapterIds: [ids.ch1], mix: [{ type: 'MCQ', count: 1, marksEach: 1 }] })).body.data.sections[0].items[0];
      expect(pictured.imageKey).toBe(ids.q1Image);
      drawn[0].items = [pictured, ...drawn[0].items.filter((i: any) => i.questionId !== ids.q1).slice(0, 4)];
      drawn[1].attempt = 3;
      // A question typed straight onto the paper, not from the bank.
      drawn[1].items[4] = { textEn: 'Written for this paper only.', marks: 2 };

      const body = { classId: ids.cls, subjectId: ids.maths, title: 'Monthly test: October', medium: 'DUAL', durationMinutes: 45, instructions: 'Attempt all sections.', sections: drawn };
      expect((await api(u.otherTeacher).post('/papers', body)).status).toBe(403);
      const saved = await api(u.TEACHER).post('/papers', body);
      expect(saved.status).toBe(201);
      paperId = saved.body.data.id;
      // 5 MCQs × 1, any 3 of 5 shorts × 2, one matching × 4.
      expect(Number(saved.body.data.totalMarks)).toBe(5 + 6 + 4);
      expect(saved.body.data.sections[1]).toMatchObject({ attempt: 3 });
      expect(saved.body.data.sections[0].items[0].imageUrl).toContain('/api/v1/files/');

      const opened = (await api(u.TEACHER).get(`/papers/${paperId}`)).body.data;
      expect(opened).toMatchObject({ title: 'Monthly test: October', medium: 'DUAL', className: 'Class 9', subjectName: 'Mathematics' });
      expect(opened.school.name).toContain('Test');
    });

    it('refuses a paper with a broken question or someone else\'s picture', async () => {
      const base = { classId: ids.cls, subjectId: ids.maths, title: 'Bad', medium: 'EN' };
      expect((await api(u.TEACHER).post('/papers', { ...base, sections: [{ type: 'MCQ', title: 'MCQs', items: [{ textEn: 'No choices', marks: 1 }] }] })).status).toBe(422);
      expect((await api(u.TEACHER).post('/papers', { ...base, sections: [{ type: 'SHORT', title: 'Short', items: [{ textEn: 'x', marks: 1, imageKey: `${other.school.id}/questions/00000000-0000-4000-8000-000000000000.png` }] }] })).status).toBe(422);
      expect((await api(u.TEACHER).post('/papers', { ...base, medium: 'FR', sections: [{ type: 'SHORT', title: 'Short', items: [{ textEn: 'x', marks: 1 }] }] })).status).toBe(422);
    });

    it('changing or deleting a bank question leaves a saved paper as it was set', async () => {
      const before = (await api(u.TEACHER).get(`/papers/${paperId}`)).body.data.sections[0].items[0];
      await api(u.PRINCIPAL).patch(`/questions/${ids.q1}`, { ...mcq(99), marks: 5 });
      expect((await api(u.PRINCIPAL).del(`/questions/${ids.q1}`)).status).toBe(200);

      const after = (await api(u.TEACHER).get(`/papers/${paperId}`)).body.data.sections[0].items[0];
      expect(after).toMatchObject({ textEn: before.textEn, marks: 1, imageKey: ids.q1Image });
      // Its picture is kept on disk because this paper still prints it.
      const url = new URL(after.imageUrl);
      expect((await request(app).get(url.pathname + url.search)).status).toBe(200);
    });

    it('the paper can be edited and listed; only its author or the office may change it', async () => {
      const paper = (await api(u.TEACHER).get(`/papers/${paperId}`)).body.data;
      const sections = paper.sections.map((s: any) => ({ ...s, items: s.items.map(({ imageUrl: _imageUrl, ...i }: any) => i) }));
      sections[0].items[1].textEn = 'Reworded on the paper.';
      sections[1].attempt = null;
      const body = { title: 'Monthly test: October (final)', medium: 'EN', durationMinutes: 60, instructions: null, sections };
      expect((await api(u.otherTeacher).put(`/papers/${paperId}`, body)).status).toBe(403);
      const saved = await api(u.TEACHER).put(`/papers/${paperId}`, body);
      expect(saved.status).toBe(200);
      expect(Number(saved.body.data.totalMarks)).toBe(5 + 10 + 4); // every short question counts now
      expect(saved.body.data.sections[0].items[1].textEn).toBe('Reworded on the paper.');

      const mine = (await api(u.TEACHER).get('/papers')).body.data;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ title: 'Monthly test: October (final)', className: 'Class 9', subjectName: 'Mathematics' });
      expect(mine[0]).not.toHaveProperty('sections');
      expect((await api(u.otherTeacher).get('/papers')).body.data).toHaveLength(0); // teaches Urdu, not maths
      expect((await api(u.ADMIN).get('/papers')).body.data).toHaveLength(1);
      expect((await api(u.outsider).get(`/papers/${paperId}`)).status).toBe(404);
      expect((await api(u.outsider).get('/papers')).body.data).toHaveLength(0);

      expect((await api(u.otherTeacher).del(`/papers/${paperId}`)).status).toBe(403);
      expect((await api(u.ADMIN).del(`/papers/${paperId}`)).status).toBe(200);
    });
  });
});
