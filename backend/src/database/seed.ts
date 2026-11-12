import 'dotenv/config';
import { hashPassword } from '../utils/password';
import { PrismaClient, AttendanceStatus, Role, DayOfWeek } from '@prisma/client';
import { DEFAULT_DESIGNATIONS } from '../utils/staffStatus';

/**
 * Demo data for ERP v2: one full school ("greenfield") with a login for every
 * role, and a small second school ("riverside") used to check tenant isolation.
 * Uses the raw client on purpose — seeding writes across schools.
 * Re-running is a no-op if the demo school exists; use `prisma migrate reset` to start over.
 */
const prisma = new PrismaClient();
const PASSWORD = 'Admin@123';

// Deterministic pseudo-random so every seed produces the same data.
let rngState = 42;
const rand = () => ((rngState = (rngState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const FIRST = ['Ali', 'Ayesha', 'Hamza', 'Fatima', 'Usman', 'Zainab', 'Bilal', 'Maryam', 'Hassan', 'Hira', 'Omar', 'Sana', 'Saad', 'Iqra', 'Ahmed', 'Noor'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Butt', 'Sheikh', 'Qureshi', 'Raza', 'Chaudhry', 'Siddiqui', 'Javed'];

async function seedPlatform(hash: string) {
  await prisma.user.upsert({
    where: { email: 'superadmin@platform.com' },
    update: {},
    create: { name: 'Platform Admin', email: 'superadmin@platform.com', password: hash, role: 'SUPER_ADMIN' },
  });
}

async function seedGreenfield(hash: string) {
  const school = await prisma.school.create({
    data: { name: 'Greenfield Public School', code: 'greenfield', phone: '042-35761234', address: 'Model Town, Lahore' },
  });
  const schoolId = school.id;
  await prisma.designation.createMany({ data: DEFAULT_DESIGNATIONS.map((name) => ({ schoolId, name })), skipDuplicates: true });
  const year = await prisma.academicYear.create({
    data: { schoolId, name: '2026-27', startDate: day('2026-04-01'), endDate: day('2027-03-31'), isCurrent: true },
  });

  const user = (role: Role, name: string, email: string) =>
    prisma.user.create({ data: { schoolId, role, name, email, password: hash, phone: '0300' + Math.floor(1e6 + rand() * 9e6) } });

  // ─── Office users (principal/admin/accountant are also staff) ───
  await user('OWNER', 'Tariq Mehmood', 'owner@school.com');
  for (const [i, [role, name, email, designation]] of ([
    ['PRINCIPAL', 'Dr. Saima Sharif', 'principal@school.com', 'Principal'],
    ['ADMIN', 'Imran Office', 'admin@school.com', 'Office administrator'],
    ['ACCOUNTANT', 'Kashif Accounts', 'accountant@school.com', 'Accountant'],
  ] as const).entries()) {
    const u = await user(role, name, email);
    await prisma.staff.create({ data: { schoolId, userId: u.id, employeeNo: `EMP-0${i + 1}`, name, designation, department: 'Administration', isTeacher: false } });
  }

  // ─── Staff (teachers + support) ───
  const teacherSpecs = [
    { name: 'Nadia Hussain', email: 'teacher@school.com', subject: 'MATH' },
    { name: 'Asif Iqbal', email: 'teacher2@school.com', subject: 'ENG' },
    { name: 'Rabia Anwar', email: 'teacher3@school.com', subject: 'SCI' },
    { name: 'Faisal Nawaz', email: 'teacher4@school.com', subject: 'URDU' },
  ];
  const teachers = [];
  for (const [i, t] of teacherSpecs.entries()) {
    const u = await user('TEACHER', t.name, t.email);
    teachers.push(await prisma.staff.create({
      data: { schoolId, userId: u.id, employeeNo: `EMP-${101 + i}`, name: t.name, designation: 'Teacher', department: 'Academics', joiningDate: day('2022-04-01') },
    }));
  }
  const support = await prisma.staff.create({
    data: { schoolId, employeeNo: 'EMP-201', name: 'Shahid Clerk', designation: 'Clerk', department: 'Office', isTeacher: false },
  });
  const allStaff = [...teachers, support];

  // ─── Subjects ───
  const subjectDefs = [['Mathematics', 'MATH'], ['English', 'ENG'], ['Science', 'SCI'], ['Urdu', 'URDU'], ['Islamiyat', 'ISL']];
  const subjects = Object.fromEntries(await Promise.all(subjectDefs.map(async ([name, code]) =>
    [code, await prisma.subject.create({ data: { schoolId, name, code } })] as const)));

  // ─── Classes & sections ───
  const classes = [];
  for (const level of [6, 7, 8]) {
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${level}`, level } });
    const sections = [];
    for (const name of ['A', 'B']) sections.push(await prisma.section.create({ data: { schoolId, classId: cls.id, name, capacity: 35 } }));
    classes.push({ cls, sections });
  }
  const allSections = classes.flatMap((c) => c.sections);
  // Nadia (teacher@) is class teacher of 8-A.
  const class8A = classes[2].sections[0];
  await prisma.section.update({ where: { id: class8A.id }, data: { classTeacherId: teachers[0].id } });
  await prisma.section.update({ where: { id: classes[1].sections[0].id }, data: { classTeacherId: teachers[1].id } });

  // Each teacher teaches their subject in every section; ISL goes to the Urdu teacher.
  const subjectTeacher: Record<string, string> = { MATH: teachers[0].id, ENG: teachers[1].id, SCI: teachers[2].id, URDU: teachers[3].id, ISL: teachers[3].id };
  await prisma.subjectAssignment.createMany({
    data: allSections.flatMap((s) => Object.entries(subjectTeacher).map(([code, teacherId]) => ({
      schoolId, academicYearId: year.id, sectionId: s.id, subjectId: subjects[code].id, teacherId,
    }))),
  });

  // Timetable for 8-A (Mon–Fri, 5 periods).
  const days: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
  const order = ['MATH', 'ENG', 'SCI', 'URDU', 'ISL'];
  await prisma.timetableSlot.createMany({
    data: days.flatMap((d, di) => order.map((_, p) => {
      const code = order[(p + di) % order.length];
      const start = 8 + p;
      return {
        schoolId, sectionId: class8A.id, subjectId: subjects[code].id, teacherId: subjectTeacher[code], dayOfWeek: d,
        period: p + 1, startTime: `${String(start).padStart(2, '0')}:00`, endTime: `${String(start).padStart(2, '0')}:45`,
      };
    })),
  });

  // ─── Guardians & students ───
  // The parent@ login has two children (siblings) in different classes.
  const parentUser = await user('PARENT', 'Kamran Sharif', 'parent@school.com');
  const parentGuardian = await prisma.guardian.create({
    data: { schoolId, userId: parentUser.id, name: 'Kamran Sharif', phone: '03001234567', email: 'parent@school.com', occupation: 'Engineer' },
  });
  const studentUser = await user('STUDENT', 'Aarav Sharif', 'student@school.com');

  let admission = 1000;
  const students: Array<{ id: string; sectionId: string | null; classLevel: number }> = [];
  for (const section of allSections) {
    for (let i = 0; i < 8; i++) {
      const isParentsChild = (section.id === class8A.id && i === 0) || (section.id === classes[0].sections[1].id && i === 0);
      const name = isParentsChild
        ? (section.id === class8A.id ? 'Aarav Sharif' : 'Anaya Sharif')
        : `${pick(FIRST)} ${pick(LAST)}`;
      const s = await prisma.student.create({
        data: {
          schoolId, admissionNo: `GF-${++admission}`, rollNo: String(i + 1), name, sectionId: section.id,
          gender: i % 2 ? 'FEMALE' : 'MALE', dateOfBirth: day(`${2026 - 6 - (section === class8A ? 8 : 6)}-0${1 + (i % 9)}-15`),
          admissionDate: day('2024-04-01'),
          userId: section.id === class8A.id && i === 0 ? studentUser.id : undefined,
        },
      });
      const guardian = isParentsChild
        ? parentGuardian
        : await prisma.guardian.create({ data: { schoolId, name: `Mr. ${name.split(' ')[1]}`, phone: '0321' + (1000000 + admission) } });
      await prisma.studentGuardian.create({ data: { schoolId, studentId: s.id, guardianId: guardian.id, relation: 'FATHER', isPrimary: true } });
      students.push({ ...s, classLevel: classes.find((c) => c.sections.includes(section))!.cls.level });
    }
  }
  await prisma.counter.create({ data: { schoolId, key: 'admission', value: admission } });

  // ─── Fee setup ───
  const heads = {
    tuition: await prisma.feeHead.create({ data: { schoolId, name: 'Tuition', frequency: 'MONTHLY' } }),
    lab: await prisma.feeHead.create({ data: { schoolId, name: 'Lab', frequency: 'MONTHLY' } }),
    annual: await prisma.feeHead.create({ data: { schoolId, name: 'Annual Charges', frequency: 'ANNUAL' } }),
  };
  const tuitionByLevel: Record<number, number> = { 6: 4000, 7: 4250, 8: 4500 };
  for (const { cls } of classes) {
    await prisma.feeStructure.createMany({
      data: [
        { schoolId, academicYearId: year.id, classId: cls.id, feeHeadId: heads.tuition.id, amount: tuitionByLevel[cls.level] },
        { schoolId, academicYearId: year.id, classId: cls.id, feeHeadId: heads.lab.id, amount: 500 },
        { schoolId, academicYearId: year.id, classId: cls.id, feeHeadId: heads.annual.id, amount: 6000 },
      ],
    });
  }

  // Monthly invoices Aug–Nov 2026. Most families pay; a few are defaulters.
  let invoiceNo = 0;
  let receiptNo = 0;
  const accountant = await prisma.user.findUniqueOrThrow({ where: { email: 'accountant@school.com' } });
  const periods = ['2026-08', '2026-09', '2026-10', '2026-11'];
  for (const s of students) {
    const defaulter = rand() < 0.15;
    for (const [pi, period] of periods.entries()) {
      const tuition = tuitionByLevel[s.classLevel];
      const net = tuition + 500;
      const inv = await prisma.feeInvoice.create({
        data: {
          schoolId, studentId: s.id, academicYearId: year.id, invoiceNo: `INV-${String(++invoiceNo).padStart(5, '0')}`,
          period, issueDate: day(`${period}-01`), dueDate: day(`${period}-10`), grossAmount: net, netAmount: net,
        },
      });
      await prisma.feeInvoiceItem.createMany({
        data: [
          { schoolId, invoiceId: inv.id, feeHeadId: heads.tuition.id, amount: tuition },
          { schoolId, invoiceId: inv.id, feeHeadId: heads.lab.id, amount: 500 },
        ],
      });
      const isCurrentMonth = pi === periods.length - 1;
      const pays = defaulter ? pi === 0 : isCurrentMonth ? rand() < 0.55 : true;
      if (!pays) continue;
      const paidAt = new Date(day(`${period}-0${2 + Math.floor(rand() * 7)}`).getTime() + 10 * 3600e3);
      const payment = await prisma.payment.create({
        data: {
          schoolId, studentId: s.id, receiptNo: `RCP-${String(++receiptNo).padStart(5, '0')}`, amount: net,
          method: pick(['CASH', 'CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA'] as const), paidAt, collectedById: accountant.id,
        },
      });
      await prisma.paymentAllocation.create({ data: { schoolId, paymentId: payment.id, invoiceId: inv.id, amount: net } });
      await prisma.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount: net, status: 'PAID' } });
    }
  }
  await prisma.counter.createMany({
    data: [{ schoolId, key: 'invoice', value: invoiceNo }, { schoolId, key: 'receipt', value: receiptNo }],
  });

  // Pending concession awaiting principal approval.
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@school.com' } });
  await prisma.concession.create({
    data: {
      schoolId, studentId: students[3].id, feeHeadId: heads.tuition.id, type: 'PERCENT', value: 25,
      reason: 'Sibling discount request', requestedById: adminUser.id, validFrom: day('2026-12-01'),
    },
  });

  // ─── Attendance: last 30 days excluding Sundays ───
  const today = day('2026-11-07');
  const dates: Date[] = [];
  for (let d = 30; d >= 0; d--) {
    const dt = new Date(today.getTime() - d * 86400e3);
    if (dt.getUTCDay() !== 0) dates.push(dt);
  }
  const statusFor = (pPresent: number): AttendanceStatus => {
    const r = rand();
    return r < pPresent ? 'PRESENT' : r < pPresent + 0.04 ? 'LATE' : r < pPresent + 0.06 ? 'LEAVE' : 'ABSENT';
  };
  const teacherUser = await prisma.user.findUniqueOrThrow({ where: { email: 'teacher@school.com' } });
  await prisma.studentAttendance.createMany({
    data: dates.flatMap((date) => students.map((s) => ({
      schoolId, studentId: s.id, sectionId: s.sectionId!, date, status: statusFor(0.88), markedById: teacherUser.id,
    }))),
  });
  await prisma.staffAttendance.createMany({
    data: dates.flatMap((date) => allStaff.map((st) => {
      const status = statusFor(0.92);
      const checkIn = new Date(date.getTime() + (status === 'LATE' ? 8.75 : 7.75) * 3600e3);
      return { schoolId, staffId: st.id, date, status, checkIn: status === 'ABSENT' || status === 'LEAVE' ? null : checkIn, markedById: adminUser.id };
    })),
  });

  // ─── Leave, grades, calendar, notices, diary ───
  await prisma.leaveRequest.create({
    data: { schoolId, staffId: teachers[2].id, type: 'SICK', fromDate: day('2026-11-09'), toDate: day('2026-11-10'), reason: 'Medical appointment' },
  });
  await prisma.gradeScale.createMany({
    data: [['A+', 90, 100], ['A', 80, 89.99], ['B', 70, 79.99], ['C', 60, 69.99], ['D', 50, 59.99], ['F', 0, 49.99]].map(
      ([grade, minPercent, maxPercent]) => ({ schoolId, grade: grade as string, minPercent: minPercent as number, maxPercent: maxPercent as number }),
    ),
  });
  await prisma.calendarEvent.createMany({
    data: [
      { schoolId, title: 'Iqbal Day', type: 'HOLIDAY', startDate: day('2026-11-09'), endDate: day('2026-11-09') },
      { schoolId, title: 'Quaid-e-Azam Day / Winter Break', type: 'HOLIDAY', startDate: day('2026-12-22'), endDate: day('2026-12-31') },
      { schoolId, title: 'Parent-Teacher Meeting', type: 'EVENT', startDate: day('2026-11-21'), endDate: day('2026-11-21') },
    ],
  });
  const principal = await prisma.user.findUniqueOrThrow({ where: { email: 'principal@school.com' } });
  await prisma.notice.create({
    data: { schoolId, title: 'Winter uniform from 15 November', body: 'All students must wear winter uniform from 15 November.', audience: 'ALL', createdById: principal.id, publishedAt: day('2026-11-05') },
  });
  const ptm = await prisma.notice.create({
    data: { schoolId, title: 'Class 8 PTM', body: 'Parent-teacher meeting for Class 8 on 21 November, 9am–12pm.', audience: 'SECTIONS', createdById: principal.id, publishedAt: day('2026-11-06') },
  });
  await prisma.noticeTarget.createMany({ data: classes[2].sections.map((s) => ({ schoolId, noticeId: ptm.id, sectionId: s.id })) });
  await prisma.diaryEntry.createMany({
    data: [
      { schoolId, sectionId: class8A.id, subjectId: subjects.MATH.id, teacherId: teachers[0].id, date: day('2026-11-06'), content: 'Chapter 5 exercise 5.2, questions 1–10.', isHomework: true, dueDate: day('2026-11-09') },
      { schoolId, sectionId: class8A.id, subjectId: subjects.ENG.id, teacherId: teachers[1].id, date: day('2026-11-06'), content: 'Read pages 40–45 and learn new vocabulary.', isHomework: true, dueDate: day('2026-11-09') },
    ],
  });

  return { school, students: students.length, dates: dates.length };
}

// Second tenant: only enough data to prove that greenfield users can't see it.
async function seedRiverside(hash: string) {
  const school = await prisma.school.create({ data: { name: 'Riverside Grammar School', code: 'riverside' } });
  const schoolId = school.id;
  await prisma.academicYear.create({
    data: { schoolId, name: '2026-27', startDate: day('2026-04-01'), endDate: day('2027-03-31'), isCurrent: true },
  });
  await prisma.user.create({ data: { schoolId, role: 'OWNER', name: 'Riverside Owner', email: 'owner@riverside.com', password: hash } });
  await prisma.user.create({ data: { schoolId, role: 'ADMIN', name: 'Riverside Admin', email: 'admin@riverside.com', password: hash } });
  const cls = await prisma.class.create({ data: { schoolId, name: 'Class 8', level: 8 } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: 'A' } });
  await prisma.student.create({ data: { schoolId, admissionNo: 'RV-1', name: 'Riverside Student', sectionId: section.id, admissionDate: day('2025-04-01') } });
  return school;
}

async function main() {
  if (await prisma.school.findUnique({ where: { code: 'greenfield' } })) {
    console.log('Demo data already present — run `npx prisma migrate reset` to reseed.');
    return;
  }
  console.log('Seeding ERP demo data...');
  const hash = await hashPassword(PASSWORD);
  await seedPlatform(hash);
  const gf = await seedGreenfield(hash);
  await seedRiverside(hash);

  console.log(`
Greenfield: ${gf.students} students, ${gf.dates} attendance days, fee invoices Aug–Nov 2026.
Riverside: second school for tenant-isolation checks.

Logins (password ${PASSWORD}):
  superadmin@platform.com   SUPER_ADMIN (platform)
  owner@school.com          OWNER
  principal@school.com      PRINCIPAL
  admin@school.com          ADMIN
  accountant@school.com     ACCOUNTANT
  teacher@school.com        TEACHER (class teacher 8-A)
  parent@school.com         PARENT (2 children: 8-A, 6-B)
  student@school.com        STUDENT (8-A)
  owner@riverside.com       OWNER of second school
`);
}

export { main };

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
