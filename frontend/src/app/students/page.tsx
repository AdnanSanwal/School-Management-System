'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SectionSelect, Spinner, Empty, StatusBadge } from '@/components/ui/kit';
import { studentsAPI } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { sectionLabel } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function StudentsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [search, setSearch] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['students', { search, sectionId, status, page }],
    meta: { quiet: !!search },
    queryFn: () => studentsAPI.list({ search: search || undefined, sectionId: sectionId || undefined, status, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = data?.data ?? [];
  const p = data?.pagination;

  return (
    <DashboardLayout title="Students" allowedRoles={CAN.viewStudents}
      subtitle={p ? `${p.total.toLocaleString()} students` : undefined}
      actions={can(role, 'admitStudents') && <Link href="/students/new" className="btn btn-primary"><Plus className="h-4 w-4" /> New admission</Link>}>
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Name, admission no. or parent phone" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search students" />
          </div>
          <SectionSelect value={sectionId} onChange={(v) => { setSectionId(v); setPage(1); }} includeAll="All sections" className="w-48" />
          <select className="select w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="ACTIVE">Active</option>
            <option value="LEFT">Left</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="GRADUATED">Graduated</option>
            <option value="ALL">All</option>
          </select>
        </div>

        {isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="No students found" /> : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr><th>Student</th><th>Adm. no.</th><th>Class</th><th>Parent</th><th>Status</th></tr>
              </thead>
              <tbody className={isFetching ? 'opacity-60' : ''}>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/students/${s.id}`} className="font-medium text-gray-900 hover:text-primary-600">{s.name}</Link>
                      {s.rollNo && <span className="ml-2 text-xs text-gray-400">Roll {s.rollNo}</span>}
                    </td>
                    <td className="font-mono text-sm text-gray-600">{s.admissionNo}</td>
                    <td>{sectionLabel(s.section)}</td>
                    <td className="text-sm">{s.primaryGuardian ? <>{s.primaryGuardian.name} <span className="text-gray-400">· {s.primaryGuardian.phone}</span></> : '—'}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {p && p.pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
            Page {p.page} of {p.pages}
            <button className="btn-icon btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button className="btn-icon btn-ghost" disabled={page >= p.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
