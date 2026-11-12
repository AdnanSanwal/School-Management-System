'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Building2, Users, GraduationCap, Trash2, TriangleAlert } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, Stat } from '@/components/ui/kit';
import { SearchInput, NoMatches, matchesSearch } from '@/components/ui/SearchInput';
import { platformAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatDateTime, formatLocalDate, formatMoney, todayIso } from '@/lib/utils';

export default function PlatformPage() {
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ['platform', 'schools'], queryFn: platformAPI.schools });
  const [open, setOpen] = useState(false);
  const [licence, setLicence] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const term = search.trim();
  const shown = data.filter((s: any) => matchesSearch(term, s.name, s.code, s.phone, s.owners.map((o: any) => [o.name, o.email])));
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformAPI.setActive(id, isActive),
    onSuccess: (_r, v) => { toast.success(v.isActive ? 'School activated' : 'School suspended'); qc.invalidateQueries({ queryKey: ['platform'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const active = data.filter((s: any) => s.isActive);
  const attention = data.filter((s: any) => s.isActive && s.licence.state !== 'ACTIVE');

  return (
    <DashboardLayout title="Schools" allowedRoles={CAN.platform} subtitle="Every school on this platform"
      actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New school</button>}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Schools" value={data.length} sub={`${active.length} active`} icon={Building2} />
        <Stat label="Active students" value={data.reduce((n: number, s: any) => n + s.activeStudents, 0)} icon={GraduationCap} tone="good" />
        <Stat label="User accounts" value={data.reduce((n: number, s: any) => n + s._count.users, 0)} icon={Users} />
        <Stat label="Subscriptions needing attention" value={attention.length} icon={TriangleAlert} tone={attention.length ? 'warn' : 'default'}
          sub={attention.length ? `${attention.filter((s: any) => s.licence.state === 'LOCKED').length} locked, ${attention.filter((s: any) => s.licence.state === 'GRACE').length} in grace, ${attention.filter((s: any) => s.licence.state === 'DUE_SOON').length} due soon` : 'All paid up'} />
      </div>
      <div className="card space-y-3">
        {data.length > 0 && <SearchInput className="w-80 max-w-full" placeholder="School name, code, phone, owner" value={search} onChange={setSearch} aria-label="Search schools" />}
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : !data.length ? <Empty title="No schools yet" />
          : !shown.length ? <NoMatches term={term} what="schools" onClear={() => setSearch('')} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>School</th><th>Owner</th><th>Students</th><th>Users</th><th>Joined</th><th>Subscription</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((s: any) => (
                  <tr key={s.id}>
                    <td><p className="font-medium">{s.name}</p><p className="text-xs text-gray-500"><code>{s.code}</code>{s.phone ? ` · ${s.phone}` : ''}</p></td>
                    <td className="text-sm">{s.owners.map((o: any) => (
                      <div key={o.email}>{o.name} <span className="text-gray-500">{o.email}</span>
                        <span className="block text-xs text-gray-400">{o.lastLoginAt ? `last login ${formatDateTime(o.lastLoginAt)}` : 'never logged in'}</span></div>
                    ))}</td>
                    <td>{s.activeStudents}{s.licence.maxStudents ? <span className="text-xs text-gray-500"> / {s.licence.maxStudents}</span> : null}</td>
                    <td>{s._count.users}</td>
                    <td className="text-sm">{formatLocalDate(s.createdAt)}</td>
                    <td className="text-sm"><LicenceBadge state={s.licence.state} />
                      <span className="block text-xs text-gray-500">{s.licence.plan ? `${s.licence.plan} · ` : ''}{s.licence.paidUntil ? `until ${formatDate(s.licence.paidUntil)}` : 'no end date'}</span></td>
                    <td>{s.isActive ? <span className="badge badge-green">active</span> : <span className="badge badge-red">suspended</span>}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setLicence(s)}>Subscription</button>
                      <button className="btn btn-ghost px-2 py-1 text-xs" disabled={toggle.isPending}
                        onClick={() => confirm(s.isActive ? `Suspend ${s.name}? Its users will not be able to log in.` : `Activate ${s.name}?`) && toggle.mutate({ id: s.id, isActive: !s.isActive })}>
                        {s.isActive ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <NewSchool onClose={() => setOpen(false)} />}
      {licence && <LicenceModal school={licence} onClose={() => setLicence(null)} />}
    </DashboardLayout>
  );
}

function NewSchool({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const y = new Date().getFullYear();
  const [f, setF] = useState({
    name: '', code: '', phone: '', email: '', address: '',
    yearName: `${y}-${String(y + 1).slice(2)}`, startDate: `${y}-04-01`, endDate: `${y + 1}-03-31`,
    ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '',
    plan: '', paidUntil: '', maxStudents: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => platformAPI.create({
      name: f.name, code: f.code, phone: f.phone || undefined, email: f.email || undefined, address: f.address || undefined,
      academicYear: { name: f.yearName, startDate: f.startDate, endDate: f.endDate },
      owner: { name: f.ownerName, email: f.ownerEmail, phone: f.ownerPhone || undefined, password: f.ownerPassword },
      licence: f.plan || f.paidUntil || f.maxStudents ? { plan: f.plan || undefined, paidUntil: f.paidUntil || undefined, maxStudents: f.maxStudents ? Number(f.maxStudents) : undefined } : undefined,
    }),
    onSuccess: () => { toast.success('School created — the owner can log in now'); qc.invalidateQueries({ queryKey: ['platform'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New school" wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="School name"><input className="input" required minLength={2} value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value, code: f.code || '' })} /></Field>
          <Field label="Code" hint="lowercase letters, digits, dashes — used at login"><input className="input" required pattern="[a-z0-9-]{2,40}" value={f.code} onChange={set('code')} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="input" value={f.email} onChange={set('email')} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">First academic year</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><input className="input" required value={f.yearName} onChange={set('yearName')} /></Field>
            <Field label="Starts"><input type="date" className="input" required value={f.startDate} onChange={set('startDate')} /></Field>
            <Field label="Ends"><input type="date" className="input" required value={f.endDate} onChange={set('endDate')} /></Field>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Owner login</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" required minLength={2} value={f.ownerName} onChange={set('ownerName')} /></Field>
            <Field label="Email"><input type="email" className="input" required value={f.ownerEmail} onChange={set('ownerEmail')} /></Field>
            <Field label="Phone"><input className="input" value={f.ownerPhone} onChange={set('ownerPhone')} /></Field>
            <Field label="Password" hint="at least 8 characters; share it with the owner"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={f.ownerPassword} onChange={set('ownerPassword')} /></Field>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Subscription <span className="font-normal text-gray-400">(optional; can be set later)</span></h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plan"><input className="input" maxLength={60} placeholder="e.g. Standard" value={f.plan} onChange={set('plan')} /></Field>
            <Field label="Paid until" hint="Empty = no end date"><input type="date" className="input" value={f.paidUntil} onChange={set('paidUntil')} /></Field>
            <Field label="Student limit" hint="Empty = no limit"><input type="number" min={1} className="input" value={f.maxStudents} onChange={set('maxStudents')} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending}>Create school</button>
        </div>
      </form>
    </Modal>
  );
}

const LICENCE_BADGE: Record<string, [string, string]> = {
  ACTIVE: ['active', 'badge-green'], DUE_SOON: ['due soon', 'badge-yellow'], GRACE: ['in grace', 'badge-orange'], LOCKED: ['locked', 'badge-red'],
};
function LicenceBadge({ state }: { state: string }) {
  const [label, cls] = LICENCE_BADGE[state] ?? [state, 'badge-gray'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** One school's subscription: plan, dates, limit, note, and the payments received. */
function LicenceModal({ school, onClose }: { school: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'licence', school.id], queryFn: () => platformAPI.licence(school.id) });
  const [f, setF] = useState<any | null>(null);
  const today = todayIso();
  const [pay, setPay] = useState({ amount: '', paidOn: today, paidUntil: '', method: '', reference: '', note: '' });
  const st = data?.status;
  // Fill the form once the school's figures arrive.
  if (data && !f) {
    setF({ plan: st.plan ?? '', paidUntil: st.paidUntil ?? '', graceDays: String(st.graceDays), notifyDays: String(st.notifyDays), maxStudents: st.maxStudents ? String(st.maxStudents) : '', message: st.message ?? '', override: data.override });
    // A sensible next end date: one month after the current one (or after today).
    const from = new Date(`${st.paidUntil && st.paidUntil > today ? st.paidUntil : today}T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() + 1);
    setPay((p) => ({ ...p, paidUntil: from.toISOString().slice(0, 10) }));
  }
  const done = (r: { data: { data: any; message: string } }) => {
    toast.success(r.data.message); qc.setQueryData(['platform', 'licence', school.id], r.data.data); qc.invalidateQueries({ queryKey: ['platform', 'schools'] });
    const s2 = r.data.data.status; setF((old: any) => ({ ...old, paidUntil: s2.paidUntil ?? '' }));
  };
  const onError = (e: unknown) => toast.error(apiError(e), { duration: 7000 });
  const save = useMutation({
    mutationFn: () => platformAPI.saveLicence(school.id, {
      plan: f.plan.trim() || null, paidUntil: f.paidUntil || null, graceDays: Number(f.graceDays || 0), notifyDays: Number(f.notifyDays || 0),
      maxStudents: f.maxStudents ? Number(f.maxStudents) : null, message: f.message.trim() || null, override: f.override,
    }),
    onSuccess: done, onError,
  });
  const addPayment = useMutation({
    mutationFn: () => platformAPI.addPayment(school.id, { amount: Number(pay.amount), paidOn: pay.paidOn, paidUntil: pay.paidUntil, method: pay.method.trim() || undefined, reference: pay.reference.trim() || undefined, note: pay.note.trim() || undefined }),
    onSuccess: (r) => { done(r); setPay((p) => ({ ...p, amount: '', reference: '', note: '' })); }, onError,
  });
  const removePayment = useMutation({ mutationFn: (id: string) => platformAPI.deletePayment(school.id, id), onSuccess: done, onError });

  return (
    <Modal open onClose={onClose} title={`Subscription — ${school.name}`} wide>
      {isLoading || !f ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <LicenceBadge state={st.state} /><span className="text-gray-700">{st.summary}</span>
            <span className="ml-auto text-gray-500">{data.activeStudents} active student{data.activeStudents === 1 ? '' : 's'}{st.maxStudents ? ` of ${st.maxStudents}` : ''}</span>
          </div>

          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Plan"><input className="input" maxLength={60} placeholder="e.g. Standard" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
              <Field label="Paid until" hint="Empty = no end date"><input type="date" className="input" value={f.paidUntil} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} /></Field>
              <Field label="Student limit" hint="Empty = no limit"><input type="number" min={1} className="input" value={f.maxStudents} onChange={(e) => setF({ ...f, maxStudents: e.target.value })} /></Field>
              <Field label="Warn this many days before" hint="The school sees a notice"><input type="number" min={0} max={90} required className="input" value={f.notifyDays} onChange={(e) => setF({ ...f, notifyDays: e.target.value })} /></Field>
              <Field label="Grace days after the end" hint="Still works, with a red notice"><input type="number" min={0} max={90} required className="input" value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.override} onChange={(e) => setF({ ...f, override: e.target.checked })} /> Keep on whatever the date</label>
            </div>
            <Field label="Message shown to the school" hint="Optional, e.g. where to send the payment"><input className="input" maxLength={300} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
            <div className="flex justify-end"><button className="btn btn-primary" disabled={save.isPending}>Save subscription</button></div>
          </form>

          <div className="border-t border-slate-100 pt-4">
            <h4 className="mb-2 text-sm font-semibold text-gray-700">Record a payment</h4>
            <form className="grid items-end gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); addPayment.mutate(); }}>
              <Field label={`Amount (${data.school.currency})`}><input type="number" min={0.01} step="0.01" required className="input" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
              <Field label="Received on"><input type="date" required max={today} className="input" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></Field>
              <Field label="Now paid until"><input type="date" required className="input" value={pay.paidUntil} onChange={(e) => setPay({ ...pay, paidUntil: e.target.value })} /></Field>
              <Field label="Method"><input className="input" maxLength={40} placeholder="Bank, cash…" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></Field>
              <Field label="Reference" className="sm:col-span-1"><input className="input" maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
              <Field label="Note" className="sm:col-span-2"><input className="input" maxLength={300} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
              <button className="btn btn-primary" disabled={addPayment.isPending}>Record payment</button>
            </form>
            <div className="mt-3">
              {data.payments.length === 0 ? <p className="text-sm text-gray-500">No payments recorded yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Received</th><th className="text-right">Amount</th><th>Paid until</th><th>Details</th><th /></tr></thead>
                    <tbody>{data.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td className="text-sm">{formatDate(p.paidOn)}</td>
                        <td className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                        <td className="text-sm">{formatDate(p.coversUntil)}</td>
                        <td className="text-sm text-gray-500">{[p.method, p.reference, p.note].filter(Boolean).join(' · ')}</td>
                        <td className="text-right">{p.removable && <button className="btn btn-ghost px-2 py-1 text-red-600" aria-label="Remove payment" disabled={removePayment.isPending}
                          onClick={() => confirm('Remove this payment? The paid-until date goes back to what it was before.') && removePayment.mutate(p.id)}><Trash2 className="h-4 w-4" /></button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
