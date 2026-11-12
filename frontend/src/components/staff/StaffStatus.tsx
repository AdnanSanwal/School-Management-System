import { cn } from '@/lib/utils';

/** Staff statuses (client change request 03). Active and temporary leave are "on roll": paid, login works. */
export const STAFF_STATUS: Record<string, { label: string; badge: string; about: string }> = {
  ACTIVE: { label: 'Active', badge: 'badge-green', about: 'Currently employed and working. Paid; login works.' },
  TEMPORARY_LEAVE: { label: 'Temporary leave', badge: 'badge-yellow', about: 'Away for a while but still employed. Stays on payroll; login keeps working.' },
  INACTIVE: { label: 'Inactive', badge: 'badge-gray', about: 'Not currently working. Taken off payroll and the login is disabled.' },
  LEFT: { label: 'Left', badge: 'badge-gray', about: 'Has left the school. Off payroll, login disabled, class-teacher duties released.' },
  TERMINATED: { label: 'Terminated', badge: 'badge-red', about: 'Employment ended by the school. Off payroll, login disabled, class-teacher duties released.' },
};

export const STATUS_OPTIONS: [string, string][] = Object.entries(STAFF_STATUS).map(([k, v]) => [k, v.label]);

export function StaffStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STAFF_STATUS[status] ?? { label: status, badge: 'badge-gray' };
  return <span className={cn('badge', s.badge, className)}>{s.label}</span>;
}
