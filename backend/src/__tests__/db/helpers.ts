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

  async function destroy() {
    const where = { schoolId: school.id };
    // Children before parents.
    await basePrisma.paymentAllocation.deleteMany({ where });
    await basePrisma.payment.deleteMany({ where });
    await basePrisma.feeInvoiceItem.deleteMany({ where });
    await basePrisma.feeInvoice.deleteMany({ where });
    await basePrisma.concession.deleteMany({ where });
    await basePrisma.feeStructure.deleteMany({ where });
    await basePrisma.feeHead.deleteMany({ where });
    await basePrisma.notification.deleteMany({ where });
    await basePrisma.studentAttendance.deleteMany({ where });
    await basePrisma.staffAttendance.deleteMany({ where });
    await basePrisma.leaveRequest.deleteMany({ where });
    await basePrisma.mark.deleteMany({ where });
    await basePrisma.examSubject.deleteMany({ where });
    await basePrisma.exam.deleteMany({ where });
    await basePrisma.gradeScale.deleteMany({ where });
    await basePrisma.diaryAttachment.deleteMany({ where });
    await basePrisma.diaryEntry.deleteMany({ where });
    await basePrisma.noticeRead.deleteMany({ where });
    await basePrisma.noticeTarget.deleteMany({ where });
    await basePrisma.notice.deleteMany({ where });
    await basePrisma.calendarEvent.deleteMany({ where });
    await basePrisma.timetableSlot.deleteMany({ where });
    await basePrisma.subjectAssignment.deleteMany({ where });
    await basePrisma.studentDocument.deleteMany({ where });
    await basePrisma.studentGuardian.deleteMany({ where });
    await basePrisma.student.deleteMany({ where });
    await basePrisma.guardian.deleteMany({ where });
    await basePrisma.staff.deleteMany({ where });
    await basePrisma.section.deleteMany({ where });
    await basePrisma.subject.deleteMany({ where });
    await basePrisma.class.deleteMany({ where });
    await basePrisma.counter.deleteMany({ where });
    await basePrisma.pushSubscription.deleteMany({ where });
    await basePrisma.deviceToken.deleteMany({ where });
    await basePrisma.auditLog.deleteMany({ where });
    await basePrisma.user.deleteMany({ where });
    await basePrisma.academicYear.deleteMany({ where });
    await basePrisma.school.delete({ where: { id: school.id } });
  }

  return { school, year, code, user, destroy };
}

export function tokenFor(u: { id: string; role: string; email: string; schoolId: string | null }) {
  return signToken({ id: u.id, role: u.role, email: u.email, schoolId: u.schoolId });
}
