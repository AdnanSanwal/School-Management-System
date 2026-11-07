/**
 * Runs against the real database seeded by src/database/seed.ts.
 * Skipped unless RUN_DB_TESTS=1 (CI has no MySQL):
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db
 */
import 'dotenv/config';
import prisma, { basePrisma } from '../../config/database';
import { runWithTenant, TenantViolationError } from '../../config/tenancy';
import { studentScope, assertStudentAccess, teacherSectionIds, ensureInSchool } from '../../utils/scope';
import type { JwtPayload } from '../../utils/jwt';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;

d('tenant isolation (database)', () => {
  let greenfield: string;
  let riverside: string;
  let riversideStudentId: string;
  const users: Record<string, JwtPayload> = {};

  beforeAll(async () => {
    greenfield = (await basePrisma.school.findUniqueOrThrow({ where: { code: 'greenfield' } })).id;
    riverside = (await basePrisma.school.findUniqueOrThrow({ where: { code: 'riverside' } })).id;
    riversideStudentId = (await basePrisma.student.findFirstOrThrow({ where: { schoolId: riverside } })).id;
    for (const email of ['owner@school.com', 'teacher@school.com', 'parent@school.com', 'student@school.com']) {
      const u = await basePrisma.user.findUniqueOrThrow({ where: { email } });
      users[u.role] = { id: u.id, role: u.role, email: u.email, schoolId: u.schoolId };
    }
  });

  afterAll(() => basePrisma.$disconnect());

  it('scoped client refuses to run without a tenant context', async () => {
    await expect(prisma.student.findMany()).rejects.toThrow(TenantViolationError);
  });

  it('a school only sees its own students', async () => {
    const [gf, all] = await Promise.all([
      runWithTenant(greenfield, () => prisma.student.count()),
      basePrisma.student.count(),
    ]);
    expect(gf).toBe(await basePrisma.student.count({ where: { schoolId: greenfield } }));
    expect(gf).toBeLessThan(all);
  });

  it("another school's record looks like it does not exist", async () => {
    const found = await runWithTenant(greenfield, () => prisma.student.findUnique({ where: { id: riversideStudentId } }));
    expect(found).toBeNull();
  });

  it("updates and deletes cannot reach another school's rows", async () => {
    const res = await runWithTenant(greenfield, () =>
      prisma.student.updateMany({ where: { id: riversideStudentId }, data: { name: 'hacked' } }),
    );
    expect(res.count).toBe(0);
    await expect(
      runWithTenant(greenfield, () => prisma.student.update({ where: { id: riversideStudentId }, data: { name: 'hacked' } })),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect((await basePrisma.student.findUniqueOrThrow({ where: { id: riversideStudentId } })).name).toBe('Riverside Student');
  });

  it('creating a row for another school is blocked', async () => {
    await expect(
      runWithTenant(greenfield, () =>
        prisma.class.create({ data: { schoolId: riverside, name: 'Sneaky', level: 99 } }),
      ),
    ).rejects.toThrow(TenantViolationError);
  });

  it('ensureInSchool rejects foreign keys from another school', async () => {
    const rvSection = await basePrisma.section.findFirstOrThrow({ where: { schoolId: riverside } });
    await expect(runWithTenant(greenfield, () => ensureInSchool(prisma.section, rvSection.id, 'Section'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('parent sees exactly their two linked children', async () => {
    const kids = await runWithTenant(greenfield, async () =>
      prisma.student.findMany({ where: await studentScope(users.PARENT), select: { name: true } }),
    );
    expect(kids.map((k) => k.name).sort()).toEqual(['Aarav Sharif', 'Anaya Sharif']);
  });

  it("parent cannot open another child's record", async () => {
    const other = await basePrisma.student.findFirstOrThrow({
      where: { schoolId: greenfield, guardians: { none: { guardian: { userId: users.PARENT.id } } } },
    });
    await expect(runWithTenant(greenfield, () => assertStudentAccess(users.PARENT, other.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('student sees only themselves', async () => {
    const me = await runWithTenant(greenfield, async () => prisma.student.findMany({ where: await studentScope(users.STUDENT) }));
    expect(me).toHaveLength(1);
    expect(me[0].userId).toBe(users.STUDENT.id);
  });

  it('teacher sees only students of their sections', async () => {
    await runWithTenant(greenfield, async () => {
      const sections = await teacherSectionIds(users.TEACHER.id);
      expect(sections.length).toBeGreaterThan(0);
      const visible = await prisma.student.findMany({ where: await studentScope(users.TEACHER), select: { sectionId: true } });
      expect(visible.every((s) => sections.includes(s.sectionId!))).toBe(true);
    });
  });

  it('owner sees the whole school', async () => {
    const n = await runWithTenant(greenfield, async () => prisma.student.count({ where: await studentScope(users.OWNER) }));
    expect(n).toBe(await basePrisma.student.count({ where: { schoolId: greenfield } }));
  });
});
