import { Router } from 'express';
import { z } from 'zod';
import { Prisma, QuestionType } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { handler, id, me, paginationSchema, paging, parseBody, parseQuery } from '../../utils/http';
import { currentAcademicYear, staffForUser } from '../../utils/scope';
import { assertKind, deleteFile, saveFile, signedUrl } from '../../utils/storage';
import { audit } from '../../utils/audit';
import { uploadOne } from '../files/files.routes';
import type { JwtPayload } from '../../utils/jwt';
import { cancelUsage, finishUsage, reserveUsage, resolveAi } from '../ai/ai.service';
import { AI_LANGUAGES, AI_TYPES, draftPaper, draftToSections } from './aiPaper';
import { parsePaperText } from './paperText';

/**
 * Test maker: the school's own question bank, and papers built from it.
 *
 *   bank    class → subject → chapter → topic → question. A question is written in
 *           English, Urdu or both, and is one of six types.
 *   paper   the teacher chooses chapters and how many questions of each type; questions
 *           are drawn at random, spread across the chosen chapters. The paper keeps its
 *           own copy of each question, so editing a paper never changes the bank and
 *           editing the bank never changes a paper that was already set.
 *
 * Papers are printed from the web panel (the browser lays out Urdu correctly).
 *
 * Who: office staff who manage exams see everything. A teacher sees and adds to the
 * classes and subjects they teach this year.
 */

const router = Router();
router.use(authenticate, can('marks.enter', 'exam.manage'));

// ─── Who may work on which class and subject ───

const pairKey = (classId: string, subjectId: string) => `${classId}|${subjectId}`;

/** null = every class and subject; otherwise the class|subject pairs this teacher teaches. */
async function allowedPairs(user: JwtPayload): Promise<Set<string> | null> {
  if (hasPermission(user.role, 'exam.manage')) return null;
  const [year, staff] = await Promise.all([currentAcademicYear(), staffForUser(user.id)]);
  if (!staff) return new Set();
  const rows = await prisma.subjectAssignment.findMany({
    where: { teacherId: staff.id, academicYearId: year.id },
    select: { subjectId: true, section: { select: { classId: true } } },
  });
  return new Set(rows.map((r) => pairKey(r.section.classId, r.subjectId)));
}

async function assertPair(user: JwtPayload, classId: string, subjectId: string) {
  const pairs = await allowedPairs(user);
  if (pairs && !pairs.has(pairKey(classId, subjectId))) throw new AppError('You do not teach this subject in this class', 403);
}

/** The chapter, after checking the user may work on its class and subject. */
async function chapterFor(user: JwtPayload, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId } });
  if (!chapter) throw new AppError('Chapter not found', 404);
  await assertPair(user, chapter.classId, chapter.subjectId);
  return chapter;
}

/** Only the person who made something, or office staff, may change or remove it. */
function assertOwner(user: JwtPayload, createdById: string, what: string) {
  if (createdById !== user.id && !hasPermission(user.role, 'exam.manage')) throw new AppError(`Only the person who added this ${what}, or the office, can change it`, 403);
}

router.get('/scope', handler(async (req, res) => {
  const pairs = await allowedPairs(me(req));
  const ai = !!(await resolveAi(currentSchoolId()));
  const [classes, subjects] = await Promise.all([
    prisma.class.findMany({ where: { archivedAt: null }, orderBy: { level: 'asc' }, select: { id: true, name: true } }),
    prisma.subject.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  if (!pairs) return sendSuccess(res, { classes, subjects, pairs: null, ai });
  const list = [...pairs].map((p) => ({ classId: p.split('|')[0], subjectId: p.split('|')[1] }));
  return sendSuccess(res, {
    classes: classes.filter((c) => list.some((p) => p.classId === c.id)),
    subjects: subjects.filter((s) => list.some((p) => p.subjectId === s.id)),
    pairs: list,
    ai,
  });
}));

// ─── Chapters and topics ───

const name = z.string().trim().min(1).max(150);
const classSubject = z.object({ classId: id, subjectId: id });

router.get('/chapters', handler(async (req, res) => {
  const q = parseQuery(classSubject, req);
  await assertPair(me(req), q.classId, q.subjectId);
  const [chapters, counts] = await Promise.all([
    prisma.chapter.findMany({ where: q, orderBy: { number: 'asc' }, include: { topics: { orderBy: { name: 'asc' } } } }),
    prisma.question.groupBy({ by: ['chapterId'], where: q, _count: true }),
  ]);
  const countOf = new Map(counts.map((c) => [c.chapterId, c._count]));
  return sendSuccess(res, chapters.map((c) => ({ ...c, questions: countOf.get(c.id) ?? 0 })));
}));

router.post('/chapters', handler(async (req, res) => {
  const b = parseBody(classSubject.extend({ number: z.coerce.number().int().min(1).max(200), name, nameUr: name.nullable().optional() }), req);
  await assertPair(me(req), b.classId, b.subjectId);
  const [cls, subject, taken] = await Promise.all([
    prisma.class.findFirst({ where: { id: b.classId } }),
    prisma.subject.findFirst({ where: { id: b.subjectId } }),
    prisma.chapter.findFirst({ where: { classId: b.classId, subjectId: b.subjectId, number: b.number } }),
  ]);
  if (!cls || !subject) throw new AppError('Class or subject not found', 422);
  if (taken) throw new AppError(`Chapter ${b.number} already exists for this subject: "${taken.name}"`, 409);
  const created = await prisma.chapter.create({ data: { ...b, schoolId: currentSchoolId() } });
  return sendSuccess(res, created, 'Chapter added', 201);
}));

router.patch('/chapters/:id', handler(async (req, res) => {
  const b = parseBody(z.object({ number: z.coerce.number().int().min(1).max(200).optional(), name: name.optional(), nameUr: name.nullable().optional() }), req);
  const chapter = await chapterFor(me(req), req.params.id);
  if (b.number && b.number !== chapter.number
    && await prisma.chapter.findFirst({ where: { classId: chapter.classId, subjectId: chapter.subjectId, number: b.number } })) {
    throw new AppError(`Chapter ${b.number} already exists for this subject`, 409);
  }
  return sendSuccess(res, await prisma.chapter.update({ where: { id: chapter.id }, data: b }), 'Chapter updated');
}));

router.delete('/chapters/:id', handler(async (req, res) => {
  const chapter = await chapterFor(me(req), req.params.id);
  const questions = await prisma.question.count({ where: { chapterId: chapter.id } });
  if (questions) throw new AppError(`This chapter has ${questions} question${questions === 1 ? '' : 's'}. Delete or move them first.`, 409);
  await prisma.chapter.delete({ where: { id: chapter.id } });
  return sendSuccess(res, null, 'Chapter deleted');
}));

router.post('/chapters/:id/topics', handler(async (req, res) => {
  const b = parseBody(z.object({ name, nameUr: name.nullable().optional() }), req);
  const chapter = await chapterFor(me(req), req.params.id);
  const created = await prisma.topic.create({ data: { ...b, chapterId: chapter.id, schoolId: currentSchoolId() } });
  return sendSuccess(res, created, 'Topic added', 201);
}));

router.delete('/topics/:id', handler(async (req, res) => {
  const topic = await prisma.topic.findFirst({ where: { id: req.params.id } });
  if (!topic) throw new AppError('Topic not found', 404);
  await chapterFor(me(req), topic.chapterId);
  await prisma.topic.delete({ where: { id: topic.id } }); // its questions stay, without a topic
  return sendSuccess(res, null, 'Topic deleted');
}));

// ─── Questions ───

const text = z.string().trim().min(1).max(4000);
/** Words in English, Urdu, or both. */
const words = z.object({ en: text.optional(), ur: text.optional() }).strict().refine((w) => !!(w.en || w.ur), 'Write it in English, Urdu or both');
const SOURCES = ['EXERCISE', 'CONCEPTUAL', 'PAST_PAPER', 'OTHER'] as const;

const questionFields = z.object({
  topicId: id.nullable().optional(),
  type: z.nativeEnum(QuestionType),
  textEn: text.nullable().optional(),
  textUr: text.nullable().optional(),
  options: z.array(z.unknown()).max(10).nullable().optional(),
  answer: z.unknown().optional(),
  marks: z.coerce.number().min(0.5).max(100).multipleOf(0.5).default(1),
  source: z.enum(SOURCES).nullable().optional(),
});
type QuestionInput = z.infer<typeof questionFields>;

/**
 * Checks the parts that depend on the type and returns them in their stored shape.
 * Throws a plain Error with a message a teacher can act on.
 *
 * On a paper (not in the bank) the answer to an objective question may be left unmarked:
 * a paper pasted in as text has no answers until the teacher marks them.
 */
export function shapeQuestion(q: QuestionInput, answerOptional = false): { options: Prisma.InputJsonValue | typeof Prisma.DbNull; answer: Prisma.InputJsonValue | typeof Prisma.DbNull } {
  const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown, message: string): z.infer<S> => {
    const r = schema.safeParse(value);
    if (!r.success) throw new Error(message);
    return r.data;
  };
  if (q.type !== 'MATCH' && !q.textEn && !q.textUr) throw new Error('Write the question in English, Urdu or both');
  switch (q.type) {
    case 'MCQ': {
      const options = parse(z.array(words).min(2).max(6), q.options, 'A multiple-choice question needs 2 to 6 choices');
      if (answerOptional && (q.answer === undefined || q.answer === null)) return { options, answer: Prisma.DbNull };
      const answer = parse(z.object({ index: z.number().int().min(0) }), q.answer, 'Mark which choice is correct');
      if (answer.index >= options.length) throw new Error('The correct choice is not one of the choices');
      return { options, answer };
    }
    case 'TRUE_FALSE':
      if (answerOptional && (q.answer === undefined || q.answer === null)) return { options: Prisma.DbNull, answer: Prisma.DbNull };
      return { options: Prisma.DbNull, answer: parse(z.object({ value: z.boolean() }), q.answer, 'Say whether the statement is true or false') };
    case 'MATCH': {
      const pairs = parse(z.array(z.object({ left: words, right: words }).strict()).min(2).max(10), q.options, 'Matching needs 2 to 10 pairs, each with both sides filled in');
      return { options: pairs, answer: Prisma.DbNull };
    }
    default: {
      // BLANK, SHORT, LONG: a model answer is optional.
      if (q.answer === undefined || q.answer === null) return { options: Prisma.DbNull, answer: Prisma.DbNull };
      return { options: Prisma.DbNull, answer: parse(words, q.answer, 'The answer must be text in English, Urdu or both') };
    }
  }
}

const withImage = <T extends { imageKey: string | null }>(q: T) => ({ ...q, imageUrl: signedUrl(q.imageKey) });

router.get('/questions', handler(async (req, res) => {
  const q = parseQuery(paginationSchema.merge(classSubject).extend({
    chapterId: id.optional(), topicId: id.optional(), type: z.nativeEnum(QuestionType).optional(), search: z.string().trim().max(100).optional(),
  }), req);
  await assertPair(me(req), q.classId, q.subjectId);
  const where: Prisma.QuestionWhereInput = {
    classId: q.classId, subjectId: q.subjectId,
    ...(q.chapterId ? { chapterId: q.chapterId } : {}), ...(q.topicId ? { topicId: q.topicId } : {}), ...(q.type ? { type: q.type } : {}),
    ...(q.search ? { OR: [{ textEn: { contains: q.search } }, { textUr: { contains: q.search } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.question.findMany({
      where, ...paging(q), orderBy: [{ chapter: { number: 'asc' } }, { type: 'asc' }, { createdAt: 'asc' }],
      include: { chapter: { select: { number: true, name: true } }, topic: { select: { name: true } } },
    }),
    prisma.question.count({ where }),
  ]);
  return sendPaginated(res, rows.map(withImage), total, q.page, q.limit);
}));

/** How many questions of each type the chosen chapters hold (for the "how many of each" screen). */
router.get('/questions/counts', handler(async (req, res) => {
  const q = parseQuery(classSubject.extend({ chapterIds: z.string().max(8000).optional(), topicIds: z.string().max(8000).optional() }), req);
  await assertPair(me(req), q.classId, q.subjectId);
  const list = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
  const chapterIds = list(q.chapterIds); const topicIds = list(q.topicIds);
  const rows = await prisma.question.groupBy({
    by: ['type'], _count: true,
    where: { classId: q.classId, subjectId: q.subjectId, ...(chapterIds.length ? { chapterId: { in: chapterIds } } : {}), ...(topicIds.length ? { topicId: { in: topicIds } } : {}) },
  });
  return sendSuccess(res, Object.fromEntries(Object.values(QuestionType).map((t) => [t, rows.find((r) => r.type === t)?._count ?? 0])));
}));

async function assertTopic(topicId: string | null | undefined, chapterId: string) {
  if (topicId && !(await prisma.topic.findFirst({ where: { id: topicId, chapterId } }))) throw new AppError('That topic is not in this chapter', 422);
}

router.post('/questions', handler(async (req, res) => {
  const b = parseBody(questionFields.extend({ chapterId: id }), req);
  const chapter = await chapterFor(me(req), b.chapterId);
  await assertTopic(b.topicId, chapter.id);
  let shaped;
  try { shaped = shapeQuestion(b); } catch (e) { throw new AppError((e as Error).message, 422); }
  const created = await prisma.question.create({
    data: {
      schoolId: currentSchoolId(), classId: chapter.classId, subjectId: chapter.subjectId, chapterId: chapter.id, topicId: b.topicId ?? null,
      type: b.type, textEn: b.textEn ?? null, textUr: b.textUr ?? null, marks: b.marks, source: b.source ?? null, createdById: me(req).id, ...shaped,
    },
  });
  return sendSuccess(res, withImage(created), 'Question added', 201);
}));

/** Many questions at once into one chapter (from a spreadsheet). All are saved, or none. */
router.post('/questions/import', handler(async (req, res) => {
  const b = parseBody(z.object({ chapterId: id, rows: z.array(z.unknown()).min(1).max(500) }), req);
  const chapter = await chapterFor(me(req), b.chapterId);
  const errors: { row: number; message: string }[] = [];
  const data: Prisma.QuestionCreateManyInput[] = [];
  b.rows.forEach((raw, i) => {
    const parsed = questionFields.omit({ topicId: true }).safeParse(raw);
    if (!parsed.success) { errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Not a valid question' }); return; }
    try {
      const shaped = shapeQuestion(parsed.data);
      data.push({
        schoolId: currentSchoolId(), classId: chapter.classId, subjectId: chapter.subjectId, chapterId: chapter.id,
        type: parsed.data.type, textEn: parsed.data.textEn ?? null, textUr: parsed.data.textUr ?? null, marks: parsed.data.marks,
        source: parsed.data.source ?? null, createdById: me(req).id, ...shaped,
      });
    } catch (e) { errors.push({ row: i + 1, message: (e as Error).message }); }
  });
  if (errors.length) return res.status(422).json({ success: false, message: `${errors.length} row${errors.length === 1 ? ' has' : 's have'} a problem. Nothing was imported.`, errors: errors.slice(0, 50) });
  await prisma.question.createMany({ data });
  return sendSuccess(res, { created: data.length }, `${data.length} question${data.length === 1 ? '' : 's'} imported`, 201);
}));

async function questionFor(user: JwtPayload, questionId: string) {
  const q = await prisma.question.findFirst({ where: { id: questionId } });
  if (!q) throw new AppError('Question not found', 404);
  await assertPair(user, q.classId, q.subjectId);
  assertOwner(user, q.createdById, 'question');
  return q;
}

router.patch('/questions/:id', handler(async (req, res) => {
  const b = parseBody(questionFields.extend({ chapterId: id.optional() }), req);
  const existing = await questionFor(me(req), req.params.id);
  const chapter = b.chapterId && b.chapterId !== existing.chapterId ? await chapterFor(me(req), b.chapterId) : null;
  if (chapter && (chapter.classId !== existing.classId || chapter.subjectId !== existing.subjectId)) throw new AppError('A question can only move to another chapter of the same class and subject', 422);
  await assertTopic(b.topicId, chapter?.id ?? existing.chapterId);
  let shaped;
  try { shaped = shapeQuestion(b); } catch (e) { throw new AppError((e as Error).message, 422); }
  const updated = await prisma.question.update({
    where: { id: existing.id },
    data: { ...(chapter ? { chapterId: chapter.id } : {}), topicId: b.topicId ?? null, type: b.type, textEn: b.textEn ?? null, textUr: b.textUr ?? null, marks: b.marks, source: b.source ?? null, ...shaped },
  });
  return sendSuccess(res, withImage(updated), 'Question updated');
}));

/** A picture is removed from disk only if no saved paper still shows it. */
async function dropImage(key: string | null) {
  if (!key) return;
  const used = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM papers WHERE schoolId = ${currentSchoolId()} AND JSON_SEARCH(sections, 'one', ${key}) IS NOT NULL`;
  if (!Number(used[0]?.n ?? 0)) await deleteFile(key);
}

router.delete('/questions/:id', handler(async (req, res) => {
  const q = await questionFor(me(req), req.params.id);
  await prisma.question.delete({ where: { id: q.id } });
  await dropImage(q.imageKey);
  return sendSuccess(res, null, 'Question deleted');
}));

router.post('/questions/:id/image', uploadOne, handler(async (req, res) => {
  const q = await questionFor(me(req), req.params.id);
  if (!req.file) throw new AppError('Choose a picture to upload', 422);
  const key = await saveFile(currentSchoolId(), 'questions', req.file.buffer, assertKind(req.file.buffer, ['jpg', 'png', 'webp']));
  const updated = await prisma.question.update({ where: { id: q.id }, data: { imageKey: key } });
  await dropImage(q.imageKey);
  return sendSuccess(res, withImage(updated), 'Picture added');
}));

router.delete('/questions/:id/image', handler(async (req, res) => {
  const q = await questionFor(me(req), req.params.id);
  const updated = await prisma.question.update({ where: { id: q.id }, data: { imageKey: null } });
  await dropImage(q.imageKey);
  return sendSuccess(res, withImage(updated), 'Picture removed');
}));

// ─── Papers ───

const SECTION_TITLES: Record<QuestionType, { en: string; ur: string }> = {
  MCQ: { en: 'Multiple choice questions', ur: 'کثیر الانتخابی سوالات' },
  TRUE_FALSE: { en: 'True or false', ur: 'درست یا غلط' },
  BLANK: { en: 'Fill in the blanks', ur: 'خالی جگہ پُر کریں' },
  SHORT: { en: 'Short questions', ur: 'مختصر سوالات' },
  LONG: { en: 'Long questions', ur: 'تفصیلی سوالات' },
  MATCH: { en: 'Match the columns', ur: 'کالم ملائیں' },
};

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * `count` questions at random, taken in turns from each chapter so the paper covers all
 * the chosen chapters rather than whichever happens to have the most questions.
 */
export function spreadPick<T extends { chapterId: string }>(pool: T[], count: number): T[] {
  const byChapter = new Map<string, T[]>();
  for (const q of shuffle(pool)) { const list = byChapter.get(q.chapterId); if (list) list.push(q); else byChapter.set(q.chapterId, [q]); }
  const queues = shuffle([...byChapter.values()]);
  const picked: T[] = [];
  while (picked.length < count && queues.some((q) => q.length)) {
    for (const queue of queues) { if (picked.length >= count) break; const next = queue.pop(); if (next) picked.push(next); }
  }
  return picked;
}

/** Draws questions for a new paper, or replacements for an existing one. Nothing is saved. */
router.post('/papers/draw', handler(async (req, res) => {
  const b = parseBody(classSubject.extend({
    chapterIds: z.array(id).min(1).max(200),
    topicIds: z.array(id).max(500).optional(),
    mix: z.array(z.object({ type: z.nativeEnum(QuestionType), count: z.coerce.number().int().min(1).max(100), marksEach: z.coerce.number().min(0.5).max(100).multipleOf(0.5).optional() })).min(1).max(12),
    excludeIds: z.array(id).max(1000).optional(),
  }), req);
  await assertPair(me(req), b.classId, b.subjectId);
  const taken = new Set(b.excludeIds ?? []);
  const short: { type: QuestionType; wanted: number; available: number }[] = [];
  const sections = [];
  for (const m of b.mix) {
    const pool = await prisma.question.findMany({
      where: {
        classId: b.classId, subjectId: b.subjectId, type: m.type, chapterId: { in: b.chapterIds },
        ...(b.topicIds?.length ? { topicId: { in: b.topicIds } } : {}),
      },
    });
    const free = pool.filter((q) => !taken.has(q.id));
    const picked = spreadPick(free, m.count);
    picked.forEach((q) => taken.add(q.id));
    if (picked.length < m.count) short.push({ type: m.type, wanted: m.count, available: picked.length });
    sections.push({
      type: m.type, title: SECTION_TITLES[m.type].en, titleUr: SECTION_TITLES[m.type].ur,
      items: picked.map((q) => ({
        questionId: q.id, textEn: q.textEn, textUr: q.textUr, options: q.options, answer: q.answer,
        marks: m.marksEach ?? Number(q.marks), imageKey: q.imageKey, imageUrl: signedUrl(q.imageKey),
      })),
    });
  }
  return sendSuccess(res, { sections, short });
}));

/** EN, UR and AR are one language; DUAL is English beside Urdu. Arabic is stored in the right-to-left field. */
const MEDIUMS = ['EN', 'UR', 'AR', 'DUAL'] as const;
export const PAPER_TYPES = ['ANNUAL', 'TERM', 'MONTHLY', 'WEEKLY', 'DAILY', 'HALF_BOOK', 'FULL_BOOK', 'CHAPTER'] as const;
const PAPER_TYPE_NAME: Record<(typeof PAPER_TYPES)[number], string> = {
  ANNUAL: 'Annual examination', TERM: 'Term examination', MONTHLY: 'Monthly test', WEEKLY: 'Weekly test', DAILY: 'Daily test',
  HALF_BOOK: 'Half book test', FULL_BOOK: 'Full book test', CHAPTER: 'Chapter or unit test',
};

/**
 * Writes the questions with AI from a topic. Nothing is saved: the draft comes back in the
 * same shape as a draw from the bank and the teacher edits it before printing.
 */
router.post('/papers/ai', handler(async (req, res) => {
  const b = parseBody(classSubject.extend({
    language: z.enum(AI_LANGUAGES),
    paperType: z.enum(PAPER_TYPES).nullable().optional(),
    board: z.string().trim().max(60).nullable().optional(),
    topic: z.string().trim().min(2).max(500),
    instructions: z.string().trim().max(2000).nullable().optional(),
    mix: z.array(z.object({ type: z.enum(AI_TYPES), count: z.coerce.number().int().min(1).max(40), marksEach: z.coerce.number().min(0.5).max(100).multipleOf(0.5) })).min(1).max(6),
  }), req);
  const ai = await resolveAi(currentSchoolId());
  if (!ai) throw new AppError('AI is not set up for this school. A school admin can connect an AI account under Settings, AI.', 503);
  await assertPair(me(req), b.classId, b.subjectId);
  if (b.mix.reduce((n, m) => n + m.count, 0) > 80) throw new AppError('Ask for at most 80 questions in one draft.', 422);
  const [cls, subject] = await Promise.all([
    prisma.class.findFirst({ where: { id: b.classId }, select: { name: true } }),
    prisma.subject.findFirst({ where: { id: b.subjectId }, select: { name: true } }),
  ]);
  if (!cls || !subject) throw new AppError('Class or subject not found', 422);
  // The draft takes its place in the school's allowance before the AI is asked, and gives
  // it back if nothing usable comes out.
  const usageId = await reserveUsage({ schoolId: currentSchoolId(), userId: me(req).id, ai, feature: 'PAPER' });
  let result: Awaited<ReturnType<typeof draftPaper>>;
  try {
    result = await draftPaper(ai, {
      className: cls.name, subjectName: subject.name, language: b.language, paperType: b.paperType ? PAPER_TYPE_NAME[b.paperType] : null,
      board: b.board || null, topic: b.topic, instructions: b.instructions || null, mix: b.mix,
    });
  } catch (e) {
    await cancelUsage(usageId);
    throw e;
  }
  const { draft, inputTokens, outputTokens } = result;
  const marksOf = (type: QuestionType) => b.mix.find((m) => m.type === type)?.marksEach ?? 1;
  const sections = draftToSections(draft, b.language, marksOf).map((s) => ({
    ...s,
    // A heading written in Urdu or Arabic goes in the right-to-left heading.
    title: b.language === 'EN' ? s.title : SECTION_TITLES[s.type].en,
    titleUr: b.language === 'EN' ? SECTION_TITLES[s.type].ur : s.title,
  }));
  if (!sections.length) {
    await cancelUsage(usageId);
    throw new AppError('The AI did not return any usable questions. Please try again.', 502);
  }
  const short = b.mix.map((m) => ({ type: m.type, wanted: m.count, available: sections.filter((s) => s.type === m.type).reduce((n, s) => n + s.items.length, 0) })).filter((m) => m.available < m.wanted);
  const questions = sections.reduce((n, s) => n + s.items.length, 0);
  await finishUsage(usageId, { questions, inputTokens, outputTokens });
  await audit(req, { action: 'PAPER_AI_DRAFTED', entity: 'Paper', meta: { classId: b.classId, subjectId: b.subjectId, questions, provider: ai.provider, source: ai.source } });
  return sendSuccess(res, { sections, short });
}));

/** Lays out a paper pasted as plain text. The words are kept as typed; nothing is saved. */
router.post('/papers/parse', handler(async (req, res) => {
  const b = parseBody(z.object({ text: z.string().min(10).max(60000) }), req);
  const parsed = parsePaperText(b.text);
  if (!parsed.questions) throw new AppError('No questions were found. Number each question (1. 2. 3.) and put each on its own line.', 422);
  if (parsed.sections.length > 12) throw new AppError('This paper changes question type too many times. Group the questions under headings such as "Short questions" and paste again.', 422);
  return sendSuccess(res, { ...parsed, short: [] });
}));

const paperItem = z.object({
  questionId: id.nullable().optional(),
  textEn: text.nullable().optional(),
  textUr: text.nullable().optional(),
  options: z.array(z.unknown()).max(10).nullable().optional(),
  answer: z.unknown().optional(),
  marks: z.coerce.number().min(0.5).max(100).multipleOf(0.5),
  imageKey: z.string().max(255).nullable().optional(),
});
const paperSection = z.object({
  type: z.nativeEnum(QuestionType),
  title: z.string().trim().min(1).max(150),
  titleUr: z.string().trim().max(150).nullable().optional(),
  /** "Attempt any N": the section counts N questions' marks, not all of them. */
  attempt: z.coerce.number().int().min(1).max(100).nullable().optional(),
  items: z.array(paperItem).min(1).max(100),
});
const paperBody = classSubject.extend({
  title: z.string().trim().min(1).max(150),
  medium: z.enum(MEDIUMS),
  paperType: z.enum(PAPER_TYPES).nullable().optional(),
  board: z.string().trim().max(60).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600).nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  sections: z.array(paperSection).min(1).max(12),
});
type PaperSection = z.infer<typeof paperSection>;

/** A section with "attempt any N" counts its N highest-mark questions. */
export function totalMarks(sections: { attempt?: number | null; items: { marks: number }[] }[]): number {
  return sections.reduce((sum, s) => {
    const marks = s.items.map((i) => Number(i.marks)).sort((a, b) => b - a);
    const counted = s.attempt && s.attempt < marks.length ? marks.slice(0, s.attempt) : marks;
    return sum + counted.reduce((t, m) => t + m, 0);
  }, 0);
}

/** Checks each item the way a bank question is checked, and that its picture is this school's. */
function cleanSections(sections: PaperSection[]) {
  const prefix = `${currentSchoolId()}/questions/`;
  return sections.map((s, si) => ({
    type: s.type, title: s.title, titleUr: s.titleUr ?? null,
    attempt: s.attempt && s.attempt < s.items.length ? s.attempt : null,
    items: s.items.map((item, qi) => {
      let shaped;
      try { shaped = shapeQuestion({ ...item, type: s.type, marks: item.marks }, true); } catch (e) { throw new AppError(`${s.title}, question ${qi + 1}: ${(e as Error).message}`, 422); }
      if (item.imageKey && !item.imageKey.startsWith(prefix)) throw new AppError(`Section ${si + 1}, question ${qi + 1}: unknown picture`, 422);
      return {
        questionId: item.questionId ?? null, textEn: item.textEn ?? null, textUr: item.textUr ?? null,
        options: shaped.options === Prisma.DbNull ? null : shaped.options, answer: shaped.answer === Prisma.DbNull ? null : shaped.answer,
        marks: item.marks, imageKey: item.imageKey ?? null,
      };
    }),
  }));
}

const withPictures = (sections: unknown) => (sections as { items: { imageKey: string | null }[] }[])
  .map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, imageUrl: signedUrl(i.imageKey) })) }));

router.get('/papers', handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ classId: id.optional(), subjectId: id.optional() }), req);
  const pairs = await allowedPairs(me(req));
  const where: Prisma.PaperWhereInput = {
    ...(q.classId ? { classId: q.classId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}),
    // A teacher sees papers for what they teach, and anything they made themselves.
    ...(pairs ? { OR: [{ createdById: me(req).id }, ...[...pairs].map((p) => ({ classId: p.split('|')[0], subjectId: p.split('|')[1] }))] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.paper.findMany({ where, ...paging(q), orderBy: { createdAt: 'desc' }, select: { id: true, title: true, classId: true, subjectId: true, medium: true, paperType: true, totalMarks: true, durationMinutes: true, createdById: true, createdAt: true, updatedAt: true } }),
    prisma.paper.count({ where }),
  ]);
  const [classes, subjects, authors] = await Promise.all([
    prisma.class.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true } }),
    prisma.subject.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.subjectId))] } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }),
  ]);
  const nameOf = (list: { id: string; name: string }[], key: string) => list.find((x) => x.id === key)?.name ?? null;
  return sendPaginated(res, rows.map((r) => ({ ...r, className: nameOf(classes, r.classId), subjectName: nameOf(subjects, r.subjectId), createdBy: nameOf(authors, r.createdById) })), total, q.page, q.limit);
}));

async function paperFor(user: JwtPayload, paperId: string, toChange = false) {
  const paper = await prisma.paper.findFirst({ where: { id: paperId } });
  if (!paper) throw new AppError('Paper not found', 404);
  if (paper.createdById !== user.id) await assertPair(user, paper.classId, paper.subjectId);
  if (toChange) assertOwner(user, paper.createdById, 'paper');
  return paper;
}

router.get('/papers/:id', handler(async (req, res) => {
  const paper = await paperFor(me(req), req.params.id);
  const [cls, subject, school] = await Promise.all([
    prisma.class.findFirst({ where: { id: paper.classId }, select: { name: true } }),
    prisma.subject.findFirst({ where: { id: paper.subjectId }, select: { name: true } }),
    prisma.school.findUnique({ where: { id: currentSchoolId() }, select: { name: true, logoUrl: true } }),
  ]);
  return sendSuccess(res, { ...paper, sections: withPictures(paper.sections), className: cls?.name ?? null, subjectName: subject?.name ?? null, school });
}));

router.post('/papers', handler(async (req, res) => {
  const b = parseBody(paperBody, req);
  await assertPair(me(req), b.classId, b.subjectId);
  const sections = cleanSections(b.sections);
  const created = await prisma.paper.create({
    data: {
      schoolId: currentSchoolId(), classId: b.classId, subjectId: b.subjectId, title: b.title, medium: b.medium, paperType: b.paperType ?? null, board: b.board || null,
      durationMinutes: b.durationMinutes ?? null, instructions: b.instructions ?? null, sections, totalMarks: totalMarks(sections), createdById: me(req).id,
    },
  });
  await audit(req, { action: 'PAPER_CREATED', entity: 'Paper', entityId: created.id, meta: { title: b.title, totalMarks: Number(created.totalMarks) } });
  return sendSuccess(res, { ...created, sections: withPictures(created.sections) }, 'Paper saved', 201);
}));

router.put('/papers/:id', handler(async (req, res) => {
  const b = parseBody(paperBody.omit({ classId: true, subjectId: true }), req);
  const paper = await paperFor(me(req), req.params.id, true);
  const sections = cleanSections(b.sections);
  const updated = await prisma.paper.update({
    where: { id: paper.id },
    data: { title: b.title, medium: b.medium, paperType: b.paperType ?? null, board: b.board || null, durationMinutes: b.durationMinutes ?? null, instructions: b.instructions ?? null, sections, totalMarks: totalMarks(sections) },
  });
  return sendSuccess(res, { ...updated, sections: withPictures(updated.sections) }, 'Paper saved');
}));

router.delete('/papers/:id', handler(async (req, res) => {
  const paper = await paperFor(me(req), req.params.id, true);
  await prisma.paper.delete({ where: { id: paper.id } });
  await audit(req, { action: 'PAPER_DELETED', entity: 'Paper', entityId: paper.id, meta: { title: paper.title } });
  return sendSuccess(res, null, 'Paper deleted');
}));

export default router;
