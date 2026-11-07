import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, id, me } from '../../utils/http';
import { toDate, toIso, schoolToday } from '../../utils/dates';
import { assertSectionAccess, assertStudentAccess, ensureInSchool, isSchoolWide, staffForUser, studentScope, teacherSectionIds } from '../../utils/scope';
import { assertKind, deleteFile, MIME, saveFile, signedUrl } from '../../utils/storage';
import { uploadMany } from '../files/files.routes';
import { familiesOfSections, notify } from '../../utils/notify';
import type { JwtPayload } from '../../utils/jwt';

// Daily diary & homework (spec §8 Teacher → Post Daily Diary; §10 Parents → Daily Diary).

const router = Router();
router.use(authenticate);

const include = {
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true } },
  attachments: { select: { id: true, url: true, fileName: true, mimeType: true } },
} satisfies Prisma.DiaryEntryInclude;

type Entry = Prisma.DiaryEntryGetPayload<{ include: typeof include }>;

function present(e: Entry) {
  return {
    ...e,
    date: toIso(e.date),
    dueDate: e.dueDate ? toIso(e.dueDate) : null,
    attachments: e.attachments.map(({ url, ...a }) => ({ ...a, href: signedUrl(url) })),
  };
}

/** Sections whose diary this user may read; null = all sections. */
async function readableSections(user: JwtPayload): Promise<string[] | null> {
  if (isSchoolWide(user)) return null;
  if (user.role === 'TEACHER') return teacherSectionIds(user.id);
  const kids = await prisma.student.findMany({ where: { AND: [await studentScope(user), { status: 'ACTIVE' }] }, select: { sectionId: true } });
  return [...new Set(kids.map((k) => k.sectionId).filter((s): s is string => !!s))];
}

router.get('/', can('diary.view', 'diary.post'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    sectionId: id.optional(),
    studentId: id.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    homework: z.enum(['true', 'false']).optional(),
    mine: z.enum(['true']).optional(),
  }), req);
  const user = me(req);

  let sections = await readableSections(user);
  if (q.studentId) {
    await assertStudentAccess(user, q.studentId);
    const s = await prisma.student.findFirstOrThrow({ where: { id: q.studentId }, select: { sectionId: true } });
    sections = s.sectionId ? [s.sectionId] : [];
  }
  if (q.sectionId) {
    if (sections && !sections.includes(q.sectionId)) throw new AppError('Section not found', 404);
    sections = [q.sectionId];
  }
  const staff = await staffForUser(user.id);

  const where: Prisma.DiaryEntryWhereInput = {
    ...(sections ? { sectionId: { in: sections } } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    ...(q.homework ? { isHomework: q.homework === 'true' } : {}),
    ...(q.mine ? { teacherId: staff?.id ?? '-' } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.diaryEntry.findMany({ where, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...paging(q) }),
    prisma.diaryEntry.count({ where }),
  ]);
  // `mine` lets the apps show edit/delete only on the user's own entries.
  return sendPaginated(res, rows.map((e) => ({ ...present(e), mine: !!staff && e.teacherId === staff.id })), total, q.page, q.limit);
}));

const entryBody = z.object({
  sectionId: id,
  subjectId: id.optional().or(z.literal('').transform(() => undefined)),
  date: dateOnly.optional(),
  title: z.string().max(120).optional(),
  content: z.string().min(1).max(5000),
  isHomework: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false),
  dueDate: dateOnly.optional().or(z.literal('').transform(() => undefined)),
});

// Multipart (with up to 3 attachments in "files") or JSON.
router.post('/', can('diary.post'), uploadMany(3), handler(async (req, res) => {
  const body = parseBody(entryBody, req);
  const user = me(req);
  await assertSectionAccess(user, body.sectionId);
  await ensureInSchool(prisma.subject, body.subjectId, 'Subject');
  const staff = await staffForUser(user.id);
  if (!staff) throw new AppError('Only staff members can post to the diary', 403);

  const today = await schoolToday();
  const date = body.date ? toDate(body.date) : today;
  if (date > today) throw new AppError('Diary date cannot be in the future', 422);
  const dueDate = body.dueDate ? toDate(body.dueDate) : null;
  if (dueDate && dueDate < date) throw new AppError('Due date must be on or after the diary date', 422);

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const kinds = files.map((f) => assertKind(f.buffer, ['pdf', 'jpg', 'png', 'webp']));
  const schoolId = currentSchoolId();
  const keys: string[] = [];
  try {
    for (const [i, f] of files.entries()) keys.push(await saveFile(schoolId, 'diary', f.buffer, kinds[i]));
    const entry = await transaction(async (tx) => {
      const e = await tx.diaryEntry.create({
        data: {
          schoolId, sectionId: body.sectionId, subjectId: body.subjectId ?? null, teacherId: staff.id,
          date, title: body.title || null, content: body.content, isHomework: body.isHomework, dueDate,
        },
      });
      if (files.length) {
        await tx.diaryAttachment.createMany({
          data: files.map((f, i) => ({ schoolId, diaryEntryId: e.id, url: keys[i], fileName: f.originalname.slice(0, 190), mimeType: MIME[kinds[i]] })),
        });
      }
      return tx.diaryEntry.findUniqueOrThrow({ where: { id: e.id }, include });
    });

    // Spec: "New Daily Diary posted → Parents of that class".
    const label = entry.subject?.name ?? (entry.isHomework ? 'Homework' : 'Diary');
    const notified = await notify(await familiesOfSections([entry.sectionId]), {
      type: 'DIARY_POSTED',
      title: `${label}: ${entry.section.class.name}-${entry.section.name}`,
      body: entry.title ?? entry.content.slice(0, 140),
      data: { diaryId: entry.id, sectionId: entry.sectionId },
    });
    return sendSuccess(res, { ...present(entry), familiesNotified: notified }, 'Diary posted', 201);
  } catch (e) {
    await Promise.all(keys.map((k) => deleteFile(k)));
    throw e;
  }
}));

async function ownEntry(user: JwtPayload, entryId: string) {
  const entry = await prisma.diaryEntry.findFirst({ where: { id: entryId }, include: { attachments: true } });
  if (!entry) throw new AppError('Diary entry not found', 404);
  const staff = await staffForUser(user.id);
  if (entry.teacherId !== staff?.id && user.role !== 'PRINCIPAL') throw new AppError('Only the teacher who posted it can change it', 403);
  return entry;
}

router.patch('/:id', can('diary.post'), handler(async (req, res) => {
  const body = parseBody(entryBody.omit({ sectionId: true, date: true }).partial().strict(), req);
  await ownEntry(me(req), req.params.id);
  await ensureInSchool(prisma.subject, body.subjectId, 'Subject');
  const updated = await prisma.diaryEntry.update({
    where: { id: req.params.id },
    data: { ...body, dueDate: body.dueDate === undefined ? undefined : body.dueDate ? toDate(body.dueDate) : null },
    include,
  });
  return sendSuccess(res, present(updated), 'Diary updated');
}));

router.delete('/:id', can('diary.post'), handler(async (req, res) => {
  const entry = await ownEntry(me(req), req.params.id);
  await prisma.diaryEntry.delete({ where: { id: entry.id } });
  await Promise.all(entry.attachments.map((a) => deleteFile(a.url)));
  return sendSuccess(res, null, 'Diary entry deleted');
}));

export default router;
