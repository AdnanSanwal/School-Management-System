'use client';

import { cn } from '@/lib/utils';
import { can } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';

const LABEL: Record<string, [string, string]> = {
  DRAFT: ['Draft', 'badge-gray'],
  SUBMITTED: ['Waiting for owner', 'badge-yellow'],
  APPROVED: ['Approved, not paid', 'badge-blue'],
  PAID: ['Paid', 'badge-green'],
};

export function PayrollBadge({ status }: { status: string }) {
  const [label, cls] = LABEL[status] ?? [status, 'badge-gray'];
  return <span className={cn('badge', cls)}>{label}</span>;
}

export function usePayrollRole() {
  const role = useAuthStore((s) => s.user?.role);
  return { canManage: can(role, 'managePayroll'), canApprove: can(role, 'approvePayroll'), canView: can(role, 'viewPayroll') };
}

/** "3.5" → "3½", "2.0" → "2". */
export const days = (v: unknown) => {
  const n = Number(v);
  const whole = Math.floor(n);
  return n % 1 ? `${whole || ''}½` : String(whole);
};
