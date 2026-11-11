'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner } from '@/components/ui/kit';
import { hrAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { LEAVE_LABEL } from '@/components/hr/LeaveCard';

export default function HrSettingsPage() {
  const options = useQuery({ queryKey: ['hr', 'options'], queryFn: hrAPI.options });
  return (
    <DashboardLayout title="HR settings" allowedRoles={CAN.manageHr} subtitle="Departments, designations and the yearly leave allowance">
      <div className="grid gap-4 lg:grid-cols-2">
        {options.isLoading ? <Spinner /> : <>
          <OptionList list="departments" title="Departments" hint="E.g. Science, Administration, Accounts" items={options.data?.departments ?? []} />
          <OptionList list="designations" title="Designations" hint="E.g. Teacher, Clerk, Driver, Lab assistant" items={options.data?.designations ?? []} />
        </>}
        <LeavePolicy />
      </div>
    </DashboardLayout>
  );
}

function OptionList({ list, title, hint, items }: { list: 'departments' | 'designations'; title: string; hint: string; items: { id: string; name: string; staff: number }[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['hr'] }); qc.invalidateQueries({ queryKey: ['staff'] }); };
  const onError = (e: unknown) => toast.error(apiError(e), { duration: 6000 });
  const add = useMutation({ mutationFn: () => hrAPI.addOption(list, name.trim()), onSuccess: () => { setName(''); refresh(); }, onError });
  const rename = useMutation({ mutationFn: () => hrAPI.renameOption(list, editing!.id, editing!.name.trim()), onSuccess: () => { toast.success('Renamed. Staff records were updated too.'); setEditing(null); refresh(); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => hrAPI.deleteOption(list, id), onSuccess: () => { toast.success('Removed'); refresh(); }, onError });

  return (
    <div className="card space-y-3">
      <div><h3 className="section-title">{title}</h3><p className="text-xs text-gray-500">{hint}. These appear as choices on the staff forms.</p></div>
      <ul className="divide-y divide-slate-100">
        {items.length === 0 && <li className="py-2 text-sm text-gray-500">None yet.</li>}
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            {editing?.id === it.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
                <input className="input py-1.5" autoFocus required minLength={2} value={editing.name} onChange={(e) => setEditing({ id: it.id, name: e.target.value })} aria-label={`Rename ${it.name}`} />
                <button className="btn-icon btn-ghost h-8 w-8 text-emerald-600" aria-label="Save"><Check className="h-4 w-4" /></button>
                <button type="button" className="btn-icon btn-ghost h-8 w-8" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
              </form>
            ) : (
              <>
                <span>{it.name} <span className="text-xs text-gray-400">· {it.staff} staff</span></span>
                <span className="flex">
                  <button className="btn-icon btn-ghost h-8 w-8" aria-label={`Rename ${it.name}`} onClick={() => setEditing({ id: it.id, name: it.name })}><Pencil className="h-3.5 w-3.5" /></button>
                  <button className="btn-icon btn-ghost h-8 w-8 text-red-500" aria-label={`Remove ${it.name}`} onClick={() => confirm(`Remove “${it.name}”?`) && remove.mutate(it.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input className="input" required minLength={2} maxLength={60} placeholder={`New ${title.toLowerCase().replace(/s$/, '')}`} value={name} onChange={(e) => setName(e.target.value)} aria-label={`New ${title}`} />
        <button className="btn btn-secondary" disabled={add.isPending}><Plus className="h-4 w-4" /> Add</button>
      </form>
    </div>
  );
}

function LeavePolicy() {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ['hr', 'leave-policy'], queryFn: hrAPI.leavePolicy });
  const [rows, setRows] = useState<{ type: string; daysPerYear: string; isPaid: boolean }[]>([]);
  useEffect(() => { if (policy.data) setRows(policy.data.map((p) => ({ type: p.type, daysPerYear: String(p.daysPerYear), isPaid: p.isPaid }))); }, [policy.data]);
  const save = useMutation({
    mutationFn: () => hrAPI.saveLeavePolicy(rows.map((r) => ({ type: r.type, daysPerYear: Number(r.daysPerYear) || 0, isPaid: r.isPaid }))),
    onSuccess: () => { toast.success('Leave policy saved'); qc.invalidateQueries({ queryKey: ['hr'] }); qc.invalidateQueries({ queryKey: ['leave'] }); qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="card space-y-3 lg:col-span-2">
      <div>
        <h3 className="section-title">Leave allowance per year</h3>
        <p className="text-xs text-gray-500">Days each staff member may take in an academic year. Approved days beyond the allowance are unpaid and will be deducted in payroll. An unpaid type is always deducted.</p>
      </div>
      {policy.isLoading ? <Spinner /> : (
        <table className="w-full max-w-xl text-sm">
          <thead><tr className="text-xs text-gray-400"><th className="py-1 text-left font-normal">Leave type</th><th className="text-left font-normal">Paid?</th><th className="text-left font-normal">Days per year</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.type} className="border-t border-slate-50">
                <td className="py-2 font-medium">{LEAVE_LABEL[r.type] ?? r.type}</td>
                <td><label className="flex items-center gap-2"><input type="checkbox" checked={r.isPaid} onChange={(e) => set(i, { isPaid: e.target.checked })} aria-label={`${LEAVE_LABEL[r.type]} is paid`} /> {r.isPaid ? 'Paid' : 'Unpaid'}</label></td>
                <td>{r.isPaid
                  ? <input type="number" min="0" max="365" className="input w-24 py-1.5" value={r.daysPerYear} onChange={(e) => set(i, { daysPerYear: e.target.value })} aria-label={`${LEAVE_LABEL[r.type]} days per year`} />
                  : <span className="text-gray-400">every day unpaid</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn btn-primary" disabled={save.isPending || !rows.length} onClick={() => save.mutate()}>Save leave policy</button>
    </div>
  );
}
