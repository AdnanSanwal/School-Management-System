'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SectionSelect, Spinner, Empty, StatusBadge } from '@/components/ui/kit';
import { studentsAPI, academicsAPI } from '@/lib/api';
import { SearchInput, NoMatches, useDebounced, cleanTerm } from '@/components/ui/SearchInput';
import { Avatar } from '@/components/ui/Avatar';
import { CAN, can } from '@/lib/roles';
import { sectionLabel } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function StudentsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [search, setSearch] = useState('');
  const term = useDebounced(cleanTerm(search));
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes, staleTime: 60_000 });
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['students', { term, classId, sectionId, status, page }],
    meta: { quiet: !!term },
    queryFn: () => studentsAPI.list({ search: term || undefined, classId: classId || undefined, sectionId: sectionId || undefined, status, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = data?.data ?? [];
  const p = data?.pagination;
  const filtered = !!term || !!classId || !!sectionId || status !== 'ACTIVE';
  const reset = () => { setSearch(''); setClassId(''); setSectionId(''); setStatus('ACTIVE'); setPage(1); };
  const classList: any[] = classes.data ?? [];

  return (
    <DashboardLayout title="Students" allowedRoles={CAN.viewStudents}
      subtitle={p ? `${p.total.toLocaleString()} students` : undefined}
      actions={can(role, 'admitStudents') && <Link href="/students/new" className="btn btn-primary"><Plus className="h-4 w-4" /> New admission</Link>}>
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-3">
          <SearchInput className="min-w-[240px] flex-1" value={search} onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Name, admission no., parent name or phone" aria-label="Search students" />
          <select className="select w-40" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); setPage(1); }} aria-label="Class">
            <option value="">All classes</option>
            {classList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <SectionSelect value={sectionId} onChange={(v) => { setSectionId(v); setPage(1); }} includeAll="All sections" className="w-48" />
          <select className="select w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="ACTIVE">Active</option>
            <option value="LEFT">Left</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="GRADUATED">Graduated</option>
            <option value="ALL">All</option>
          </select>
          {filtered && <button className="btn-ghost text-sm" onClick={reset}>Reset</button>}
        </div>

        {isLoading ? <Spinner /> : rows.length === 0 ? (term
          ? <NoMatches term={term} what="students" onClear={() => { setSearch(''); setPage(1); }}>{classId || sectionId || status !== 'ACTIVE' ? 'Only the chosen class, section and status are searched.' : undefined}</NoMatches>
          : <Empty title="No students found">{filtered ? 'Try another class, section or status.' : undefined}</Empty>) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr><th>Student</th><th>Adm. no.</th><th>Class</th><th>Parent</th><th>Status</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody className={isFetching ? 'opacity-60' : ''}>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={s.name} src={s.photo ?? s.photoUrl ?? undefined} size="sm" />
                        <div>
                          <Link href={`/students/${s.id}`} className="font-medium text-gray-900 hover:text-primary-600">{s.name}</Link>
                          {s.rollNo && <p className="text-xs text-gray-400">Roll No: {s.rollNo}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-sm text-gray-600">{s.admissionNo}</td>
                    <td>{sectionLabel(s.section)}</td>
                    <td className="text-sm">{s.primaryGuardian ? <>{s.primaryGuardian.name} <span className="text-gray-400">· {s.primaryGuardian.phone}</span></> : '—'}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="text-right">
                      <Link href={`/students/${s.id}`} className="btn btn-secondary px-3 py-1.5 text-xs"><Eye className="h-3.5 w-3.5" /> View</Link>
                    </td>
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
