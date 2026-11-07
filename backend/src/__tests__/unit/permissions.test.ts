import { hasPermission, ROLE_PERMISSIONS, PERMISSIONS } from '../../middleware/rbac';

// Checks the key rules from the ERP spec's role tables (sections 4–11).
describe('role permissions follow the ERP spec', () => {
  it('owner can view and report but does not do day-to-day entry', () => {
    expect(hasPermission('OWNER', 'dashboard.owner')).toBe(true);
    expect(hasPermission('OWNER', 'reports.finance')).toBe(true);
    expect(hasPermission('OWNER', 'attendance.staff.view')).toBe(true);
    expect(hasPermission('OWNER', 'fee.collect')).toBe(false);
    expect(hasPermission('OWNER', 'attendance.student.mark')).toBe(false);
  });

  it('principal approves but does not collect fees or edit fee structure', () => {
    expect(hasPermission('PRINCIPAL', 'leave.approve')).toBe(true);
    expect(hasPermission('PRINCIPAL', 'fee.concession.approve')).toBe(true);
    expect(hasPermission('PRINCIPAL', 'exam.approve')).toBe(true);
    expect(hasPermission('PRINCIPAL', 'fee.collect')).toBe(false);
    expect(hasPermission('PRINCIPAL', 'fee.structure.manage')).toBe(false);
  });

  it('admin runs operations but cannot approve', () => {
    expect(hasPermission('ADMIN', 'student.manage')).toBe(true);
    expect(hasPermission('ADMIN', 'fee.collect')).toBe(true);
    expect(hasPermission('ADMIN', 'notice.publish')).toBe(true);
    expect(hasPermission('ADMIN', 'fee.concession.approve')).toBe(false);
    expect(hasPermission('ADMIN', 'leave.approve')).toBe(false);
  });

  it('accountant is finance only', () => {
    expect(hasPermission('ACCOUNTANT', 'fee.collect')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'reports.finance')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'fee.concession.approve')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'student.manage')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'attendance.student.view')).toBe(false);
  });

  it('teacher: attendance, diary, marks; no admin or finance', () => {
    expect(hasPermission('TEACHER', 'attendance.student.mark')).toBe(true);
    expect(hasPermission('TEACHER', 'diary.post')).toBe(true);
    expect(hasPermission('TEACHER', 'marks.enter')).toBe(true);
    expect(hasPermission('TEACHER', 'leave.apply')).toBe(true);
    expect(hasPermission('TEACHER', 'student.manage')).toBe(false);
    expect(hasPermission('TEACHER', 'fee.view')).toBe(false);
  });

  it('parent and student are read-only', () => {
    for (const role of ['PARENT', 'STUDENT']) {
      for (const p of ROLE_PERMISSIONS[role as 'PARENT']) {
        expect(p.endsWith('.view')).toBe(true);
      }
    }
    expect(hasPermission('PARENT', 'fee.view')).toBe(true);
    expect(hasPermission('STUDENT', 'fee.view')).toBe(false);
  });

  it('super admin has only platform rights, school roles never do', () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN]).toEqual(['platform.manage']);
    for (const role of Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'SUPER_ADMIN')) {
      expect(hasPermission(role, 'platform.manage')).toBe(false);
    }
  });

  it('unknown roles get nothing', () => {
    expect(hasPermission('HACKER', 'student.view')).toBe(false);
  });

  it('every granted permission exists in the catalogue', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(known.has(p)).toBe(true);
  });
});
