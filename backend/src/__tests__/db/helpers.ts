import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { basePrisma } from '../../config/database';
import { signToken } from '../../utils/jwt';

/** Creates an isolated school for a test run; `destroy()` removes every row it owns. */
export async function createTestSchool(prefix = 'test') {
  const code = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const school = await basePrisma.school.create({ data: { name: `Test ${code}`, code } });
  const year = await basePrisma.academicYear.create({
    data: { schoolId: school.id, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true },
  });
  const password = await bcrypt.hash('Test@12345', 4);

  async function user(role: Role, name = role.toLowerCase()) {
    const u = await basePrisma.user.create({
      data: { schoolId: school.id, role, name: `${name} ${code}`, email: `${name}.${code}@test.local`, password },
    });
    return { ...u, token: signToken({ id: u.id, role: u.role, email: u.email, schoolId: school.id }) };
  }

  /**
   * Deletes every row of this school from every table that has a schoolId column
   * (found from the database itself, so new tables are covered automatically).
   */
  async function destroy() {
    const tables = await basePrisma.$queryRawUnsafe<{ t: string }[]>(
      "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'schoolId'",
    );
    await basePrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const { t } of tables) await tx.$executeRawUnsafe(`DELETE FROM \`${t}\` WHERE schoolId = ?`, school.id);
      await tx.$executeRawUnsafe('DELETE FROM `schools` WHERE id = ?', school.id);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }, { timeout: 30_000 });
  }

  return { school, year, code, user, destroy };
}

export function tokenFor(u: { id: string; role: string; email: string; schoolId: string | null }) {
  return signToken({ id: u.id, role: u.role, email: u.email, schoolId: u.schoolId });
}
