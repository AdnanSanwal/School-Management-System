/**
 * CR-06: search bars. The header's global search (GET /search) and the list searches fixed
 * with it (invoices, payments, library, users): partial / case / whitespace tolerant matches,
 * and every user sees only what they may open.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/search.db.test.ts
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

type Group = { key: string; label: string; items: { id: string; title: string; subtitle?: string; href: string }[] };

d('Search (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const get = (role: string, url: string) => request(app).get(`/api/v1${url}`).set({ Authorization: `Bearer ${tok[role]}` });
  const search = async (role: string, q: string) => {
    const r = await get(role, `/search?q=${encodeURIComponent(q)}`);
    expect(r.status).toBe(200);
    const groups = r.body.data.groups as Group[];
    return { groups, group: (key: string) => groups.find((g) => g.key === key)?.items ?? [] };
  };

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('search');
    const schoolId = t.school.id;
    for (const r of ['OWNER', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT'] as const) {
      const u = await t.user(r);
      tok[r] = u.token;
      ids[`user${r}`] = u.id;
    }
    const teacher = await basePrisma.staff.create({ data: { schoolId, userId: ids.userTEACHER, employeeNo: 'T-1', name: 'Sana Teacher', designation: 'Teacher' } });
    await basePrisma.staff.create({ data: { schoolId, employeeNo: 'EMP-77', name: 'Bilal Clerk', designation: 'Clerk', department: 'Office', isTeacher: false } });

    const c8 = await basePrisma.class.create({ data: { schoolId, name: 'Class 8', level: 8 } });
    const c9 = await basePrisma.class.create({ data: { schoolId, name: 'Class 9', level: 9 } });
    const s8a = await basePrisma.section.create({ data: { schoolId, classId: c8.id, name: 'A', classTeacherId: teacher.id } });
    await basePrisma.section.create({ data: { schoolId, classId: c8.id, name: 'B' } });
    const s9a = await basePrisma.section.create({ data: { schoolId, classId: c9.id, name: 'A' } });

    const ali = await basePrisma.student.create({ data: { schoolId, admissionNo: 'ADM-901', name: 'Ali Raza Khan', admissionDate: new Date('2026-04-01'), sectionId: s8a.id } });
    const sara = await basePrisma.student.create({ data: { schoolId, admissionNo: 'ADM-902', name: 'Sara Ahmed', admissionDate: new Date('2026-04-01'), sectionId: s9a.id } });
    ids.ali = ali.id;
    ids.sara = sara.id;
    const raza = await basePrisma.guardian.create({ data: { schoolId, userId: ids.userPARENT, name: 'Raza Khan', phone: '03001234567', cnic: '35202-1111111-1' } });
    const ahmed = await basePrisma.guardian.create({ data: { schoolId, name: 'Ahmed Sheikh', phone: '03119876543' } });
    await basePrisma.studentGuardian.create({ data: { schoolId, studentId: ali.id, guardianId: raza.id, isPrimary: true } });
    await basePrisma.studentGuardian.create({ data: { schoolId, studentId: sara.id, guardianId: ahmed.id, isPrimary: true } });

    const money = { grossAmount: 5000, netAmount: 5000 };
    await basePrisma.feeInvoice.create({ data: { schoolId, studentId: ali.id, academicYearId: t.year.id, invoiceNo: 'INV-SRCH-0001', period: '2026-05', issueDate: new Date('2026-05-01'), dueDate: new Date('2026-05-10'), ...money } });
    await basePrisma.feeInvoice.create({ data: { schoolId, studentId: sara.id, academicYearId: t.year.id, invoiceNo: 'INV-SRCH-0002', period: '2026-05', issueDate: new Date('2026-05-01'), dueDate: new Date('2026-05-10'), ...money } });
    const pay = await basePrisma.payment.create({ data: { schoolId, studentId: ali.id, receiptNo: 'RCT-SRCH-1', amount: 5000, method: 'CASH', reference: 'TXN998877' } });
    ids.payment = pay.id;

    const book = await basePrisma.book.create({ data: { schoolId, title: 'Harry Potter and the Stone', author: 'J. K. Rowling', isbn: '9780747532699', copies: 1 } });
    await basePrisma.book.create({ data: { schoolId, title: 'Harry Potter and the Chamber', author: 'J. K. Rowling', copies: 2 } });
    await basePrisma.bookIssue.create({ data: { schoolId, bookId: book.id, studentId: sara.id, issuedAt: new Date('2026-05-01'), dueDate: new Date('2026-05-15'), issuedById: ids.userADMIN } });
  });
  afterAll(async () => { await t.destroy(); });

  it('rejects terms shorter than 2 characters (after trimming)', async () => {
    expect((await get('ADMIN', '/search?q=a')).status).toBe(422);
    expect((await get('ADMIN', `/search?q=${encodeURIComponent('  a  ')}`)).status).toBe(422);
    expect((await get('ADMIN', '/search')).status).toBe(422);
  });

  it('finds students by partial name in any case, word order and spacing', async () => {
    for (const q of ['ali', 'ALI', '  ali   khan ', 'khan ali', 'raza k']) {
      const { group } = await search('ADMIN', q);
      expect(group('students').map((s) => s.id)).toContain(ids.ali);
    }
    const { group } = await search('ADMIN', 'ali');
    expect(group('students')[0]).toMatchObject({ title: 'Ali Raza Khan', href: `/students/${ids.ali}` });
    expect(group('students')[0].subtitle).toContain('Class 8-A');
  });

  it('finds students by admission no. and by the parent’s name or phone; lists the parent too', async () => {
    expect((await search('ADMIN', 'adm-90')).group('students').map((s) => s.id).sort()).toEqual([ids.ali, ids.sara].sort());
    const byPhone = await search('ADMIN', '0300123');
    expect(byPhone.group('students').map((s) => s.id)).toEqual([ids.ali]);
    expect(byPhone.group('guardians')[0]).toMatchObject({ title: 'Raza Khan', href: `/students/${ids.ali}` });
    expect(byPhone.group('guardians')[0].subtitle).toContain('Ali Raza Khan');
    expect((await search('ADMIN', 'ahmed sheikh')).group('students').map((s) => s.id)).toEqual([ids.sara]);
  });

  it('finds staff by name, employee no., designation and department', async () => {
    for (const q of ['bilal', 'emp-77', 'clerk', 'office']) {
      expect((await search('ADMIN', q)).group('staff').map((s) => s.title)).toContain('Bilal Clerk');
    }
  });

  it('finds classes as "8-A", "class 8 a" or "Class 8"', async () => {
    expect((await search('ADMIN', '8-A')).group('classes')[0]).toMatchObject({ title: 'Class 8-A', href: '/classes' });
    expect((await search('ADMIN', 'class 8 a')).group('classes')[0].title).toBe('Class 8-A');
    expect((await search('ADMIN', 'Class 8')).group('classes').map((c) => c.title)).toEqual(['Class 8-A', 'Class 8-B']);
  });

  it('finds invoices and receipts by number', async () => {
    const r = await search('ACCOUNTANT', 'inv-srch');
    expect(r.group('invoices').map((i) => i.title).sort()).toEqual(['INV-SRCH-0001', 'INV-SRCH-0002']);
    expect(r.group('invoices').find((i) => i.title === 'INV-SRCH-0001')!.href).toBe(`/fees?student=${ids.ali}`);
    expect((await search('ACCOUNTANT', 'rct-srch')).group('receipts')[0]).toMatchObject({ title: 'RCT-SRCH-1', href: `/fees/receipt/${ids.payment}` });
    expect((await search('ACCOUNTANT', 'txn9988')).group('receipts')[0].title).toBe('RCT-SRCH-1');
  });

  it('finds books by any words of title / author and logins by name', async () => {
    const books = (await search('ADMIN', 'potter rowling')).group('books');
    expect(books.map((b) => b.title)).toEqual(['Harry Potter and the Chamber', 'Harry Potter and the Stone']);
    expect(books[0].href).toBe(`/library?search=${encodeURIComponent('Harry Potter and the Chamber')}`);
    expect((await search('OWNER', `teacher ${t.code}`)).group('users').map((u) => u.id)).toContain(ids.userTEACHER);
  });

  it('a teacher finds only their own sections’ students and no staff, parents, fees or logins', async () => {
    const ali = await search('TEACHER', 'ali');
    expect(ali.group('students').map((s) => s.id)).toEqual([ids.ali]);
    expect((await search('TEACHER', 'sara')).group('students')).toEqual([]);
    expect((await search('TEACHER', 'bilal')).group('staff')).toEqual([]);
    // Parent's phone is not searchable for teachers.
    expect((await search('TEACHER', '0300123')).groups).toEqual([]);
    expect((await search('TEACHER', 'inv-srch')).groups).toEqual([]);
    // Only the classes they teach.
    expect((await search('TEACHER', 'class')).group('classes').map((c) => c.title)).toEqual(['Class 8-A']);
  });

  it('a parent finds only their own child (linking to the family page) and its invoices', async () => {
    const ali = await search('PARENT', 'ali');
    expect(ali.group('students')).toEqual([expect.objectContaining({ id: ids.ali, href: '/family' })]);
    expect((await search('PARENT', 'sara')).groups).toEqual([]);
    expect((await search('PARENT', 'bilal')).groups).toEqual([]);
    expect((await search('PARENT', 'inv-srch')).group('invoices').map((i) => i.title)).toEqual(['INV-SRCH-0001']);
    expect((await search('PARENT', 'potter')).group('books')).toEqual([]);
  });

  it('invoice list: search by invoice no. or student, trimmed, together with the other filters', async () => {
    const list = async (qs: string) => {
      const r = await get('ACCOUNTANT', `/fees/invoices?${qs}`);
      expect(r.status).toBe(200);
      return (r.body.data as { invoiceNo: string }[]).map((i) => i.invoiceNo).sort();
    };
    expect(await list('search=ali')).toEqual(['INV-SRCH-0001']);
    expect(await list(`search=${encodeURIComponent(' inv-srch-0002 ')}`)).toEqual(['INV-SRCH-0002']);
    expect(await list('search=ADM-90&period=2026-05')).toEqual(['INV-SRCH-0001', 'INV-SRCH-0002']);
    expect(await list('search=ADM-90&period=2026-06')).toEqual([]);
    expect(await list(`search=${encodeURIComponent('   ')}`)).toEqual(['INV-SRCH-0001', 'INV-SRCH-0002']);
  });

  it('payments list: search also covers the transaction reference', async () => {
    const r = await get('ACCOUNTANT', `/fees/payments?from=2020-01-01&to=2030-12-31&search=${encodeURIComponent(' txn9988 ')}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((p: { receiptNo: string }) => p.receiptNo)).toEqual(['RCT-SRCH-1']);
  });

  it('library: multi-word search, and "available only" is filtered before paging', async () => {
    const all = await get('ADMIN', `/library/books?search=${encodeURIComponent('potter  ROWLING')}`);
    expect(all.body.data.map((b: { title: string }) => b.title)).toEqual(['Harry Potter and the Chamber', 'Harry Potter and the Stone']);
    // Only one result per page: the issued book must not take the slot of the available one.
    const avail = await get('ADMIN', '/library/books?search=potter&available=true&limit=1');
    expect(avail.body.data.map((b: { title: string }) => b.title)).toEqual(['Harry Potter and the Chamber']);
    expect(avail.body.pagination.total).toBe(1);
  });

  it('users list: trimmed search, also by employee no.', async () => {
    const r = await get('OWNER', `/users?search=${encodeURIComponent(' T-1 ')}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((u: { id: string }) => u.id)).toEqual([ids.userTEACHER]);
  });
});
