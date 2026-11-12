import type { StaffStatus } from '@prisma/client';

/**
 * Staff statuses (client change request 03):
 *  - On roll: ACTIVE and TEMPORARY_LEAVE — paid, login works, listed for attendance.
 *  - Off roll: INACTIVE, LEFT, TERMINATED — taken off payroll from that date and the login
 *    is disabled. Nothing is deleted; setting them back to Active restores the login.
 */
export const ON_ROLL: StaffStatus[] = ['ACTIVE', 'TEMPORARY_LEAVE'];
export const onRoll = { in: ON_ROLL };
export const STAFF_STATUSES: StaffStatus[] = ['ACTIVE', 'INACTIVE', 'TEMPORARY_LEAVE', 'LEFT', 'TERMINATED'];
export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: 'Active', INACTIVE: 'Inactive', TEMPORARY_LEAVE: 'Temporary leave', LEFT: 'Left', TERMINATED: 'Terminated',
};
export const isOnRoll = (s: StaffStatus) => ON_ROLL.includes(s);

/** Job titles every school starts with; the school can add, rename and remove its own (HR settings). */
export const DEFAULT_DESIGNATIONS = [
  'Principal', 'Vice Principal', 'Teacher', 'Accountant', 'Receptionist', 'Admin Officer', 'Admission Officer', 'Clerk',
  'Librarian', 'Computer Operator', 'Driver', 'Security Guard / Watchman', 'Sweeper', 'Cleaner', 'Peon', 'Lab Assistant',
  'Coordinator', 'HR Manager', 'Support Staff', 'Other',
];
