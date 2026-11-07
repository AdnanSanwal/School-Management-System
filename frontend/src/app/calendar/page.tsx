'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner, Empty } from '@/components/ui/kit';
import { calendarAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const TYPE_BADGE: Record<string, string> = { HOLIDAY: 'badge-blue', EVENT: 'badge-violet', EXAM: 'badge-orange' };

export default function CalendarPage() {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageCalendar');
  const qc = useQueryClient();
  const from = todayIso();
  const { data = [], isLoading } = useQuery({ queryKey: ['calendar', from], queryFn: () => calendarAPI.list({ from, to: `${Number(from.slice(0, 4)) + 1}${from.slice(4)}` }) });
  const [f, setF] = useState({ title: '', type: 'HOLIDAY', startDate: '', endDate: '', description: '' });

  const add = useMutation({
    mutationFn: () => calendarAPI.create({ ...f, endDate: f.endDate || undefined, description: f.description || undefined }),
    onSuccess: () => { toast.success('Added'); setF({ title: '', type: f.type, startDate: '', endDate: '', description: '' }); qc.invalidateQueries({ queryKey: ['calendar'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: calendarAPI.remove,
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['calendar'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Holidays & events" allowedRoles={CAN.viewCalendar} subtitle="Shown to parents in the app; holidays also appear on attendance screens">
      <div className="grid gap-4 lg:grid-cols-3">
        {manage && (
          <form className="card h-fit space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <h3 className="section-title">Add to calendar</h3>
            <Field label="Title"><input className="input" required minLength={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Eid ul Adha" /></Field>
            <Field label="Type">
              <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="HOLIDAY">Holiday</option><option value="EVENT">Event</option><option value="EXAM">Exam</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><input type="date" className="input" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              <Field label="To"><input type="date" className="input" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            </div>
            <Field label="Details (optional)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <button className="btn btn-primary w-full" disabled={add.isPending}>Add</button>
          </form>
        )}
        <div className={manage ? 'card lg:col-span-2' : 'card lg:col-span-3'}>
          {isLoading ? <Spinner /> : data.length === 0 ? <Empty title="Nothing scheduled in the next year" /> : (
            <ul className="divide-y divide-slate-100">
              {data.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="font-medium">{e.title} <span className={`badge ml-1 ${TYPE_BADGE[e.type]}`}>{e.type.toLowerCase()}</span></p>
                    <p className="text-sm text-gray-500">{formatDate(e.startDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                      {e.endDate !== e.startDate && ` – ${formatDate(e.endDate, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                      {e.description && ` · ${e.description}`}</p>
                  </div>
                  {manage && <button className="btn-icon btn-ghost text-red-500" aria-label={`Remove ${e.title}`} onClick={() => confirm(`Remove ${e.title}?`) && remove.mutate(e.id)}><Trash2 className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
