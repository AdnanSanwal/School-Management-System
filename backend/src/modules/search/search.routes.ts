import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma, { basePrisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { hasPermission, type Permission } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseQuery, me } from '../../utils/http';
import { isSchoolWide, studentScope, teacherSectionIds } from '../../utils/scope';

// CR-06: the header's "Search anything…" box. One request returns a few matches per
// kind of record, only from the kinds this user may open, and only the rows they may see
// (teachers: their sections' students; parents / students: their own family).

const router = Router();
router.use(authenticate);

export type SearchItem = { id: string; title: string; subtitle?: string; href: string };
export type SearchGroup = { key: string; label: string; items: SearchItem[] };

const MAX_WORDS = 5;

/** "  ali   khan " → "ali khan". */
export function cleanTerm(q: string) {
  return q.trim().replace(/\s+/g, ' ');
}

/** Every word must match one of the fields: "khan ali" finds "Ali Raza Khan". */
function everyWord<W>(words: string[], fields: (w: string) => W[]): { AND: { OR: W[] }[] } {
  return { AND: words.map((w) => ({ OR: fields(w) })) };
}

const sectionLabel = (s?: { name: string; class: { name: string } } | null) => (s ? `${s.class.name}-${s.name}` : 'No class');
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

router.get('/', handler(async (req, res) => {
  const q = parseQuery(z.object({
    q: z.string().max(100).transform(cleanTerm).pipe(z.string().min(2, { error: 'Type at least 2 characters' })),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  }), req);
  const user = me(req);
  const term = q.q;
  const words = term.split(' ').slice(0, MAX_WORDS);
  const take = q.limit;
  const allow = (p: Permission) => hasPermission(user.role, p);
  const schoolWide = isSchoolWide(user);
  const family = user.role === 'PARENT' || user.role === 'STUDENT';

  // The platform operator has no school: only schools are searchable.
  if (!user.schoolId) {
    if (!allow('platform.manage')) return sendSuccess(res, { q: term, groups: [] });
    const schools = await basePrisma.school.findMany({
      where: { OR: [{ name: { contains: term } }, { code: { contains: term } }] },
      take, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, isActive: true },
    });
    const groups: SearchGroup[] = [{
      key: 'schools', label: 'Schools',
      items: schools.map((s) => ({ id: s.id, title: s.name, subtitle: `${s.code}${s.isActive ? '' : ' · suspended'}`, href: '/platform' })),
    }];
    return sendSuccess(res, { q: term, groups: groups.filter((g) => g.items.length) });
  }

  const jobs: Promise<SearchGroup>[] = [];
  const scope = allow('student.view') || allow('fee.view') ? await studentScope(user) : null;

  if (allow('student.view') && scope) {
    jobs.push(prisma.student.findMany({
      where: {
        AND: [scope, everyWord<Prisma.StudentWhereInput>(words, (w) => [
          { name: { contains: w } }, { admissionNo: { contains: w } }, { rollNo: { contains: w } },
          // Office roles can also find a child by the parent's name, phone or CNIC.
          ...(schoolWide ? [{ guardians: { some: { guardian: { OR: [{ name: { contains: w } }, { phone: { contains: w } }, { cnic: { contains: w } }] } } } }] : []),
        ])],
      },
      take, orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, admissionNo: true, status: true, section: { select: { name: true, class: { select: { name: true } } } } },
    }).then((rows) => ({
      key: 'students', label: 'Students',
      items: rows.map((s) => ({
        id: s.id, title: s.name,
        subtitle: [s.admissionNo, sectionLabel(s.section), s.status !== 'ACTIVE' ? titleCase(s.status) : ''].filter(Boolean).join(' · '),
        href: family ? '/family' : `/students/${s.id}`,
      })),
    })));
  }

  if (allow('staff.view') && schoolWide) {
    jobs.push(prisma.staff.findMany({
      where: everyWord<Prisma.StaffWhereInput>(words, (w) => [
        { name: { contains: w } }, { employeeNo: { contains: w } }, { designation: { contains: w } },
        { department: { contains: w } }, { phone: { contains: w } }, { cnic: { contains: w } },
      ]),
      take, orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, employeeNo: true, designation: true, status: true },
    }).then((rows) => ({
      key: 'staff', label: 'Staff',
      items: rows.map((s) => ({
        id: s.id, title: s.name,
        subtitle: [s.employeeNo, s.designation, s.status !== 'ACTIVE' ? titleCase(s.status) : ''].filter(Boolean).join(' · '),
        href: `/staff/${s.id}`,
      })),
    })));
  }

  if (allow('student.view') && schoolWide) {
    jobs.push(prisma.guardian.findMany({
      where: {
        students: { some: {} },
        ...everyWord<Prisma.GuardianWhereInput>(words, (w) => [
          { name: { contains: w } }, { phone: { contains: w } }, { cnic: { contains: w } }, { email: { contains: w } },
        ]),
      },
      take, orderBy: { name: 'asc' },
      select: {
        id: true, name: true, phone: true,
        students: { take: 3, select: { student: { select: { id: true, name: true } } } },
      },
    }).then((rows) => ({
      key: 'guardians', label: 'Parents & guardians',
      items: rows.filter((g) => g.students.length).map((g) => ({
        id: g.id, title: g.name,
        subtitle: `${g.phone} · Parent of ${g.students.map((s) => s.student.name).join(', ')}`,
        href: `/students/${g.students[0].student.id}`,
      })),
    })));
  }

  if (allow('class.view') && !family) {
    // "8-A", "class 8 a", "Nursery": each word is in the class name, or is the section name.
    const parts = term.split(/[\s-]+/).filter(Boolean).slice(0, MAX_WORDS);
    const own = schoolWide ? null : await teacherSectionIds(user.id);
    jobs.push(prisma.section.findMany({
      where: {
        class: { archivedAt: null },
        ...(own ? { id: { in: own } } : {}),
        ...everyWord<Prisma.SectionWhereInput>(parts, (w) => [{ class: { name: { contains: w } } }, { name: w }]),
      },
      take: 50,
      select: { id: true, name: true, class: { select: { name: true, level: true } }, _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
    }).then((rows) => {
      const label = (s: (typeof rows)[number]) => `${s.class.name}-${s.name}`;
      const exact = term.toLowerCase().replace(/\s*-\s*|\s+/g, '-');
      // "8-A" should put Class 8-A first (not Class 8-B, whose "Class" also contains an "a").
      const isExact = (s: (typeof rows)[number]) => {
        const l = label(s).toLowerCase().replace(/\s+/g, '-');
        return Number(l === exact || l.endsWith(`-${exact}`));
      };
      rows.sort((a, b) => isExact(b) - isExact(a) || a.class.level - b.class.level || a.name.localeCompare(b.name));
      return {
        key: 'classes', label: 'Classes',
        items: rows.slice(0, take).map((s) => ({ id: s.id, title: label(s), subtitle: `${s._count.students} students`, href: '/classes' })),
      };
    }));
  }

  // Invoice and receipt numbers have no spaces.
  if (allow('fee.view') && scope && !term.includes(' ')) {
    jobs.push(prisma.feeInvoice.findMany({
      where: { invoiceNo: { contains: term }, student: scope },
      take, orderBy: { invoiceNo: 'desc' },
      select: { id: true, invoiceNo: true, period: true, status: true, studentId: true, student: { select: { name: true } } },
    }).then((rows) => ({
      key: 'invoices', label: 'Invoices',
      items: rows.map((i) => ({
        id: i.id, title: i.invoiceNo, subtitle: `${i.student.name} · ${i.period} · ${titleCase(i.status)}`,
        href: family ? '/family' : allow('fee.collect') ? `/fees?student=${i.studentId}` : `/students/${i.studentId}`,
      })),
    })));
    jobs.push(prisma.payment.findMany({
      where: { status: 'SUCCESS', student: scope, OR: [{ receiptNo: { contains: term } }, { reference: { contains: term } }] },
      take, orderBy: { paidAt: 'desc' },
      select: { id: true, receiptNo: true, amount: true, paidAt: true, student: { select: { name: true } } },
    }).then((rows) => ({
      key: 'receipts', label: 'Receipts',
      items: rows.map((p) => ({
        id: p.id, title: p.receiptNo, subtitle: `${p.student.name} · ${p.amount.toFixed(0)} · ${p.paidAt.toISOString().slice(0, 10)}`,
        href: `/fees/receipt/${p.id}`,
      })),
    })));
  }

  if (allow('library.view') && schoolWide) {
    jobs.push(prisma.book.findMany({
      where: everyWord<Prisma.BookWhereInput>(words, (w) => [
        { title: { contains: w } }, { author: { contains: w } }, { isbn: { contains: w } }, { category: { contains: w } },
      ]),
      take, orderBy: { title: 'asc' },
      select: { id: true, title: true, author: true, shelf: true },
    }).then((rows) => ({
      key: 'books', label: 'Library books',
      items: rows.map((b) => ({
        id: b.id, title: b.title, subtitle: [b.author, b.shelf && `Shelf ${b.shelf}`].filter(Boolean).join(' · ') || undefined,
        href: `/library?search=${encodeURIComponent(b.title)}`,
      })),
    })));
  }

  if (allow('users.manage')) {
    jobs.push(prisma.user.findMany({
      where: {
        role: { not: 'SUPER_ADMIN' },
        ...everyWord<Prisma.UserWhereInput>(words, (w) => [
          { name: { contains: w } }, { email: { contains: w } }, { username: { contains: w } }, { phone: { contains: w } },
        ]),
      },
      take, orderBy: { name: 'asc' },
      select: { id: true, name: true, username: true, email: true, role: true },
    }).then((rows) => ({
      key: 'users', label: 'Logins',
      items: rows.map((u) => ({
        id: u.id, title: u.name, subtitle: [u.username ?? u.email, titleCase(u.role)].filter(Boolean).join(' · '),
        href: `/users?search=${encodeURIComponent(u.username ?? u.email ?? u.name)}`,
      })),
    })));
  }

  const groups = (await Promise.all(jobs)).filter((g) => g.items.length);
  return sendSuccess(res, { q: term, groups });
}));

export default router;
