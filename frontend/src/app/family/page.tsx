'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner } from '@/components/ui/kit';
import { studentsAPI } from '@/lib/api';
import { formatMoney, sectionLabel } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

// Minimal parent/student view for Phase 1. The full parent app (attendance
// calendar, diary, notices, online payment) is Phase 2.
export default function FamilyPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const { data, isLoading } = useQuery({ queryKey: ['my-children'], queryFn: () => studentsAPI.list({ limit: 20 }) });
  const kids: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="My children" allowedRoles={['PARENT', 'STUDENT']} subtitle="The full parent app is coming in the next phase">
      {isLoading ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {kids.map((k) => <Child key={k.id} id={k.id} currency={currency} />)}
        </div>
      )}
    </DashboardLayout>
  );
}

function Child({ id, currency }: { id: string; currency: string }) {
  const { data: s } = useQuery({ queryKey: ['student', id], queryFn: () => studentsAPI.get(id) });
  if (!s) return <div className="card"><Spinner /></div>;
  return (
    <div className="card space-y-2">
      <h3 className="text-lg font-semibold">{s.name}</h3>
      <p className="text-sm text-gray-500">{sectionLabel(s.section)} · Class teacher {s.section?.classTeacher?.name ?? '—'}</p>
      {s.attendance && <p className="text-sm">Attendance this month: <b>{s.attendance.thisMonth.percent ?? '—'}%</b></p>}
      {s.fees && <p className="text-sm">Fee pending: <b className={Number(s.fees.pending) > 0 ? 'text-red-600' : 'text-emerald-600'}>{formatMoney(s.fees.pending, currency)}</b></p>}
    </div>
  );
}
