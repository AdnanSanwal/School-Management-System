import { Router } from 'express';
import { z } from 'zod';
import { Prisma, NoticeAudience, Role } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, id, me } from '../../utils/http';
import { studentScope, teacherSectionIds, currentAcademicYear } from '../../utils/scope';
import { assertKind, deleteFile, saveFile, signedUrl } from '../../utils/storage';
import { uploadOne } from '../files/files.routes';
import { familiesOfSections, notify } from '../../utils/notify';
import type { JwtPayload } from '../../utils/jwt';

// Notices & circulars (spec §11 module list, §12 "New Notice published → Target audience").

const router = Router();
router.use(authenticate);

const STAFF_ROLES: Role[] = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'];

/** Sections a user "belongs to" for SECTIONS notices. */
async function userSections(user: JwtPayload): Promise<string[]> {
  if (user.role === 'TEACHER') return teacherSectionIds(user.id);
  if (user.role === 'PARENT' || user.role === 'STUDENT') {
    const kids = await prisma.student.findMany({ where: { AND: [await studentScope(user), { status: 'ACTIVE' }] }, select: { sectionId: true } });
    return [...new Set(kids.map((k) => k.sectionId).filter((s): s is string => !!s))];
  }
  return [];
}

/** Notices this user may read. Publishers see everything, including drafts. */
async function visibleWhere(user: JwtPayload): Promise<Prisma.NoticeWhereInput> {
  if (hasPermission(user.role, 'notice.publish')) return {};
  const audiences: NoticeAudience[] = ['ALL'];
  if (STAFF_ROLES.includes(user.role as Role)) audiences.push('STAFF');
  if (user.role === 'PARENT') audiences.push('PARENTS');
  if (user.role === 'STUDENT') audiences.push('STUDENTS');
  const sections = await userSections(user);
  return {
    publishedAt: { not: null },
    OR: [
      { audience: { in: audiences } },
      ...(sections.length ? [{ audience: 'SECTIONS' as const, targets: { some: { sectionId: { in: sections } } } }] : []),
    ],
  };
}

async function recipients(audience: NoticeAudience, sectionIds: string[]): Promise<string[]> {
  const users = (where: Prisma.UserWhereInput) => prisma.user.findMany({ where: { isActive: true, ...where }, select: { id: true } }).then((r) => r.map((u) => u.id));
  switch (audience) {
    case 'ALL': return users({ role: { not: 'SUPER_ADMIN' } });
    case 'STAFF': return users({ role: { in: STAFF_ROLES } });
    case 'PARENTS': return users({ role: 'PARENT' });
    case 'STUDENTS': return users({ role: 'STUDENT' });
    case 'SECTIONS': {
      const year = await currentAcademicYear();
      const [families, sections, teaching] = await Promise.all([
        familiesOfSections(sectionIds),
        prisma.section.findMany({ where: { id: { in: sectionIds } }, select: { classTeacher: { select: { userId: true } } } }),
        prisma.subjectAssignment.findMany({ where: { sectionId: { in: sectionIds }, academicYearId: year.id }, select: { teacher: { select: { userId: true } } } }),
      ]);
      const teachers = [...sections.map((s) => s.classTeacher?.userId), ...teaching.map((t) => t.teacher.userId)].filter((u): u is string => !!u);
      return [...new Set([...families, ...teachers])];
    }
  }
}

const include = {
  targets: { select: { section: { select: { id: true, name: true, class: { select: { name: true } } } } } },
} satisfies Prisma.NoticeInclude;

router.get('/', can('notice.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ unread: z.enum(['true']).optional() }), req);
  const user = me(req);
  const where: Prisma.NoticeWhereInput = {
    AND: [await visibleWhere(user), q.unread ? { publishedAt: { not: null }, reads: { none: { userId: user.id } } } : {}],
  };
  const publisher = hasPermission(user.role, 'notice.publish');
  const [rows, total, unread] = await Promise.all([
    prisma.notice.findMany({
      where, ...paging(q),
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      include: { ...include, reads: { where: { userId: user.id }, select: { readAt: true } }, ...(publisher ? { _count: { select: { reads: true } } } : {}) },
    }),
    prisma.notice.count({ where }),
    prisma.notice.count({ where: { AND: [await visibleWhere(user), { publishedAt: { not: null }, reads: { none: { userId: user.id } } }] } }),
  ]);
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const data = rows.map(({ reads, attachmentUrl, ...n }) => ({
    ...n,
    author: authors.find((a) => a.id === n.createdById)?.name ?? null,
    attachment: signedUrl(attachmentUrl),
    readAt: reads[0]?.readAt ?? null,
    sections: n.targets.map((t) => `${t.section.class.name}-${t.section.name}`),
  }));
  return res.json({
    success: true, message: 'Success', data, unread,
    pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
  });
}));

const noticeBody = z.object({
  title: z.string().min(2).max(150),
  body: z.string().min(1).max(10_000),
  audience: z.nativeEnum(NoticeAudience).default('ALL'),
  // JSON array, or comma-separated when sent as multipart.
  sectionIds: z.union([z.array(id), z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))]).default([]),
  publish: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(true),
});

async function publishNotice(noticeId: string, authorId: string) {
  const n = await prisma.notice.update({ where: { id: noticeId }, data: { publishedAt: new Date() }, include });
  const userIds = (await recipients(n.audience, n.targets.map((t) => t.section.id))).filter((u) => u !== authorId);
  const notified = await notify(userIds, {
    type: 'NOTICE_PUBLISHED', title: n.title, body: n.body.slice(0, 160), data: { noticeId: n.id },
  });
  return { notice: n, notified };
}

router.post('/', can('notice.publish'), uploadOne, handler(async (req, res) => {
  const body = parseBody(noticeBody, req);
  const sectionIds = [...new Set(body.sectionIds)];
  if (body.audience === 'SECTIONS') {
    if (!sectionIds.length) throw new AppError('Choose at least one section', 422);
    if ((await prisma.section.count({ where: { id: { in: sectionIds } } })) !== sectionIds.length) throw new AppError('Unknown section', 422);
  }
  const schoolId = currentSchoolId();
  const attachmentUrl = req.file
    ? await saveFile(schoolId, 'notices', req.file.buffer, assertKind(req.file.buffer, ['pdf', 'jpg', 'png', 'webp']))
    : null;
  try {
    const created = await transaction(async (tx) => {
      const n = await tx.notice.create({
        data: { schoolId, title: body.title, body: body.body, audience: body.audience, attachmentUrl, createdById: me(req).id },
      });
      if (body.audience === 'SECTIONS') {
        await tx.noticeTarget.createMany({ data: sectionIds.map((sectionId) => ({ schoolId, noticeId: n.id, sectionId })) });
      }
      return n;
    });
    if (!body.publish) return sendSuccess(res, created, 'Draft saved', 201);
    const { notice, notified } = await publishNotice(created.id, me(req).id);
    return sendSuccess(res, { ...notice, notified }, `Notice published to ${notified} people`, 201);
  } catch (e) {
    await deleteFile(attachmentUrl);
    throw e;
  }
}));

router.post('/:id/publish', can('notice.publish'), handler(async (req, res) => {
  const n = await prisma.notice.findFirst({ where: { id: req.params.id } });
  if (!n) throw new AppError('Notice not found', 404);
  if (n.publishedAt) throw new AppError('Already published', 409);
  const { notified } = await publishNotice(n.id, me(req).id);
  return sendSuccess(res, { notified }, `Notice published to ${notified} people`);
}));

router.post('/:id/read', can('notice.view'), handler(async (req, res) => {
  const user = me(req);
  const n = await prisma.notice.findFirst({ where: { AND: [{ id: req.params.id, publishedAt: { not: null } }, await visibleWhere(user)] }, select: { id: true } });
  if (!n) throw new AppError('Notice not found', 404);
  await prisma.noticeRead.upsert({
    where: { noticeId_userId: { noticeId: n.id, userId: user.id } },
    create: { schoolId: currentSchoolId(), noticeId: n.id, userId: user.id },
    update: {},
  });
  return sendSuccess(res, null, 'Marked as read');
}));

router.delete('/:id', can('notice.publish'), handler(async (req, res) => {
  const n = await prisma.notice.findFirst({ where: { id: req.params.id } });
  if (!n) throw new AppError('Notice not found', 404);
  await prisma.notice.delete({ where: { id: n.id } });
  await deleteFile(n.attachmentUrl);
  return sendSuccess(res, null, 'Notice deleted');
}));

export default router;
