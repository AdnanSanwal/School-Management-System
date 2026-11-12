import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, id, me, patchOf } from '../../utils/http';
import { addDays, schoolToday, toDate, toIso } from '../../utils/dates';
import { assertStudentAccess, studentScope } from '../../utils/scope';
import { D } from '../fees/fees.calc';

// Library (spec module 15): books, issue/return, fines.

const router = Router();
router.use(authenticate);

const MAX_OPEN_PER_STUDENT = 3;
const DEFAULT_LOAN_DAYS = 14;

/** Late fine for a loan returned (or still out) on `on`. */
export function lateFine(dueDate: Date, on: Date, perDay: Prisma.Decimal.Value) {
  const days = Math.max(0, Math.round((on.getTime() - dueDate.getTime()) / 86_400_000));
  return { daysLate: days, fine: D(perDay).times(days) };
}

async function openCounts(bookIds: string[]) {
  const rows = await prisma.bookIssue.groupBy({ by: ['bookId'], where: { bookId: { in: bookIds }, returnedAt: null }, _count: true });
  return new Map(rows.map((r) => [r.bookId, r._count]));
}

// ─── Catalogue ───

router.get('/books', can('library.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ search: z.string().max(100).optional(), available: z.enum(['true']).optional() }), req);
  const where: Prisma.BookWhereInput = q.search
    ? { OR: [{ title: { contains: q.search } }, { author: { contains: q.search } }, { isbn: { contains: q.search } }, { category: { contains: q.search } }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.book.findMany({ where, orderBy: { title: 'asc' }, ...paging(q) }),
    prisma.book.count({ where }),
  ]);
  const out = await openCounts(rows.map((b) => b.id));
  const data = rows.map((b) => ({ ...b, issued: out.get(b.id) ?? 0, available: b.copies - (out.get(b.id) ?? 0) }))
    .filter((b) => !q.available || b.available > 0);
  return sendPaginated(res, data, total, q.page, q.limit);
}));

const bookBody = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(120).optional().nullable(),
  isbn: z.string().max(20).optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  shelf: z.string().max(30).optional().nullable(),
  copies: z.coerce.number().int().min(1).max(1000).default(1),
});

router.post('/books', can('library.manage'), handler(async (req, res) => {
  const b = parseBody(bookBody, req);
  return sendSuccess(res, await prisma.book.create({ data: { schoolId: currentSchoolId(), ...b } }), 'Book added', 201);
}));

router.patch('/books/:id', can('library.manage'), handler(async (req, res) => {
  const b = parseBody(patchOf(bookBody).strict(), req);
  if (b.copies !== undefined) {
    const out = (await openCounts([req.params.id])).get(req.params.id) ?? 0;
    if (b.copies < out) throw new AppError(`${out} copies are issued right now; copies can't go below that`, 409);
  }
  return sendSuccess(res, await prisma.book.update({ where: { id: req.params.id }, data: b }), 'Book updated');
}));

router.delete('/books/:id', can('library.manage'), handler(async (req, res) => {
  if (await prisma.bookIssue.count({ where: { bookId: req.params.id } })) throw new AppError('This book has loan history; reduce its copies instead', 409);
  const { count } = await prisma.book.deleteMany({ where: { id: req.params.id } });
  if (!count) throw new AppError('Book not found', 404);
  return sendSuccess(res, null, 'Book removed');
}));

// ─── Loans ───

const loanInclude = {
  book: { select: { id: true, title: true, author: true } },
  student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
} satisfies Prisma.BookIssueInclude;
type Loan = Prisma.BookIssueGetPayload<{ include: typeof loanInclude }>;

async function present(rows: Loan[]) {
  const today = await schoolToday();
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { libraryFinePerDay: true } });
  return rows.map((l) => {
    const open = !l.returnedAt;
    const late = open ? lateFine(l.dueDate, today, school.libraryFinePerDay) : null;
    return {
      ...l, issuedAt: toIso(l.issuedAt), dueDate: toIso(l.dueDate), returnedAt: l.returnedAt ? toIso(l.returnedAt) : null,
      overdue: open && l.dueDate < today, daysLate: late?.daysLate ?? 0,
      // Open loans show the fine so far; returned ones show what was charged.
      fineSoFar: open ? late!.fine.toString() : null,
    };
  });
}

router.post('/issues', can('library.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ bookId: id, studentId: id, dueDate: dateOnly.optional() }), req);
  const today = await schoolToday();
  const due = b.dueDate ? toDate(b.dueDate) : addDays(today, DEFAULT_LOAN_DAYS);
  if (due < today) throw new AppError('Due date is in the past', 422);
  const loan = await transaction(async (tx) => {
    const [book, student, open, studentOpen] = await Promise.all([
      tx.book.findFirst({ where: { id: b.bookId } }),
      tx.student.findFirst({ where: { id: b.studentId, status: 'ACTIVE' }, select: { id: true } }),
      tx.bookIssue.count({ where: { bookId: b.bookId, returnedAt: null } }),
      tx.bookIssue.count({ where: { studentId: b.studentId, returnedAt: null } }),
    ]);
    if (!book) throw new AppError('Book not found', 404);
    if (!student) throw new AppError('Student not found', 404);
    if (open >= book.copies) throw new AppError('No copy of this book is available', 409);
    if (studentOpen >= MAX_OPEN_PER_STUDENT) throw new AppError(`This student already has ${studentOpen} books out`, 409);
    return tx.bookIssue.create({
      data: { schoolId: currentSchoolId(), bookId: book.id, studentId: student.id, issuedAt: today, dueDate: due, issuedById: me(req).id },
      include: loanInclude,
    });
  });
  return sendSuccess(res, (await present([loan]))[0], `Issued — due ${toIso(due)}`, 201);
}));

router.post('/issues/:id/return', can('library.manage'), handler(async (req, res) => {
  const loan = await prisma.bookIssue.findFirst({ where: { id: req.params.id } });
  if (!loan) throw new AppError('Loan not found', 404);
  if (loan.returnedAt) throw new AppError('Already returned', 409);
  const today = await schoolToday();
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { libraryFinePerDay: true } });
  const { daysLate, fine } = lateFine(loan.dueDate, today, school.libraryFinePerDay);
  const { count } = await prisma.bookIssue.updateMany({
    where: { id: loan.id, returnedAt: null },
    data: { returnedAt: today, fine, finePaid: fine.lte(0) },
  });
  if (!count) throw new AppError('Already returned', 409);
  return sendSuccess(res, { daysLate, fine: fine.toString() }, fine.gt(0) ? `Returned ${daysLate} day(s) late — fine ${fine.toFixed(0)}` : 'Returned');
}));

router.post('/issues/:id/fine', can('library.manage'), handler(async (req, res) => {
  const { action } = parseBody(z.object({ action: z.enum(['paid', 'waive']) }), req);
  const loan = await prisma.bookIssue.findFirst({ where: { id: req.params.id } });
  if (!loan) throw new AppError('Loan not found', 404);
  if (!loan.returnedAt || D(loan.fine).lte(0) || loan.finePaid) throw new AppError('No unpaid fine on this loan', 409);
  await prisma.bookIssue.update({ where: { id: loan.id }, data: action === 'paid' ? { finePaid: true } : { fine: 0, finePaid: true } });
  return sendSuccess(res, null, action === 'paid' ? 'Fine marked as paid' : 'Fine waived');
}));

router.get('/issues', can('library.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    status: z.enum(['open', 'overdue', 'returned', 'unpaid-fines']).default('open'),
    studentId: id.optional(),
  }), req);
  const user = me(req);
  const today = await schoolToday();
  const where: Prisma.BookIssueWhereInput = {
    ...(hasPermission(user.role, 'library.manage') || user.role === 'OWNER' ? {} : { student: await studentScope(user) }),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.status === 'open' ? { returnedAt: null } : {}),
    ...(q.status === 'overdue' ? { returnedAt: null, dueDate: { lt: today } } : {}),
    ...(q.status === 'returned' ? { returnedAt: { not: null } } : {}),
    ...(q.status === 'unpaid-fines' ? { finePaid: false, fine: { gt: 0 } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.bookIssue.findMany({ where, include: loanInclude, orderBy: { dueDate: 'asc' }, ...paging(q) }),
    prisma.bookIssue.count({ where }),
  ]);
  return sendPaginated(res, await present(rows), total, q.page, q.limit);
}));

// One student's library account (parent app / profile).
router.get('/students/:studentId', can('library.view'), handler(async (req, res) => {
  await assertStudentAccess(me(req), req.params.studentId);
  const rows = await prisma.bookIssue.findMany({ where: { studentId: req.params.studentId }, include: loanInclude, orderBy: { issuedAt: 'desc' }, take: 50 });
  const loans = await present(rows);
  return sendSuccess(res, {
    current: loans.filter((l) => !l.returnedAt),
    history: loans.filter((l) => l.returnedAt),
    unpaidFines: loans.filter((l) => l.returnedAt && !l.finePaid && Number(l.fine) > 0).reduce((s, l) => s + Number(l.fine), 0),
  });
}));

export default router;
