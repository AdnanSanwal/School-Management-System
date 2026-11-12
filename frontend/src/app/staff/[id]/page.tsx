'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Ban, CheckCircle2, DoorOpen, FileText, PauseCircle, Pencil, Plane, Plus, Trash2, Upload, X } from 'lucide-react';
import { ActivityCard, StatusHeader, type StatusAction } from '@/components/profile/StatusHeader';
import { STAFF_STATUS, StaffStatusBadge } from '@/components/staff/StaffStatus';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner } from '@/components/ui/kit';
import { staffAPI, hrAPI, apiError, type SalaryView } from '@/lib/api';
import { LeaveCard } from '@/components/hr/LeaveCard';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const CONTRACT: Record<string, string> = { PERMANENT: 'Permanent', CONTRACT: 'Contract', VISITING: 'Visiting' };

const STAFF_ACTIONS: StatusAction[] = [
  { value: 'ACTIVE', label: 'Active', icon: CheckCircle2, tone: 'green', about: STAFF_STATUS.ACTIVE.about },
  { value: 'INACTIVE', label: 'Inactive', icon: PauseCircle, tone: 'gray', about: STAFF_STATUS.INACTIVE.about },
  { value: 'LEFT', label: 'Left', icon: DoorOpen, tone: 'amber', about: STAFF_STATUS.LEFT.about },
  { value: 'TEMPORARY_LEAVE', label: 'Temporary Leave', icon: Plane, tone: 'blue', about: STAFF_STATUS.TEMPORARY_LEAVE.about },
  { value: 'TERMINATED', label: 'Terminated', icon: Ban, tone: 'red', about: STAFF_STATUS.TERMINATED.about },
];

export default function StaffProfilePage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const currency = user?.school?.currency ?? 'PKR';
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ['staff', 'profile', id], queryFn: () => staffAPI.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['staff'] }); qc.invalidateQueries({ queryKey: ['hr'] }); };
  const [modal, setModal] = useState<null | 'edit' | 'salary' | 'doc'>(null);
  const manage = can(role, 'manageStaff');
  const setStatus = useMutation({
    mutationFn: ({ status, date, reason }: { status: string; date?: string; reason?: string }) => staffAPI.setStatus(id, { status, date, reason }),
    onSuccess: (r) => { toast.success(r.message); refresh(); for (const key of ['teachers', 'classes', 'users', 'payroll']) qc.invalidateQueries({ queryKey: [key] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title={s?.name ?? 'Staff member'} allowedRoles={CAN.viewStaff}
      subtitle={s ? `${s.employeeNo} · ${s.designation ?? (s.isTeacher ? 'Teacher' : 'Staff')}${s.department ? ` · ${s.department}` : ''}` : undefined}
      actions={<>
        <Link href="/staff" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> All staff</Link>
        {s && manage && <button className="btn btn-secondary" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" /> Edit profile</button>}
      </>}>
      {isLoading && <Spinner />}
      {error && <div className="card text-sm text-red-600">{apiError(error, 'Staff member not found')}</div>}
      {s && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-3">
            <StatusHeader
              name={s.name} noun="staff member" status={s.status} actions={STAFF_ACTIONS}
              canChange={manage} pending={setStatus.isPending}
              onChange={(status, d) => setStatus.mutate({ status, ...d })}
              subtitle={<>Employee ID: <span className="font-mono">{s.employeeNo}</span>{s.joiningDate ? <> <span className="text-gray-300">|</span> Joined {formatDate(s.joiningDate)}</> : null}</>}
              chips={<>
                <span className="badge badge-indigo">{s.designation ?? (s.isTeacher ? 'Teacher' : 'Staff')}</span>
                {s.department && <span className="badge badge-blue">{s.department}</span>}
                <StaffStatusBadge status={s.status} />
                {s.leftOn && <span className="badge badge-gray">since {formatDate(s.leftOn)}</span>}
              </>}
            />
          </div>
          <div className="card space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Profile</h3>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Item k="Employee no." v={s.employeeNo} />
              <Item k="Designation" v={s.designation} />
              <Item k="Department" v={s.department} />
              <Item k="Contract" v={CONTRACT[s.contractType]} />
              <Item k="Joined" v={s.joiningDate && formatDate(s.joiningDate)} />
              <Item k="Qualification" v={s.qualification} />
              <Item k="Phone" v={s.phone} />
              <Item k="Email" v={s.email} />
              <Item k="CNIC" v={s.cnic} />
              <Item k="Date of birth" v={s.dateOfBirth && formatDate(s.dateOfBirth)} />
              <Item k="Gender" v={s.gender?.toLowerCase()} />
              <Item k="Teaches classes" v={s.isTeacher ? 'Yes' : 'No'} />
              <Item k="Emergency contact" v={s.emergencyContactName ? `${s.emergencyContactName}${s.emergencyContactPhone ? ` · ${s.emergencyContactPhone}` : ''}` : s.emergencyContactPhone} />
              <Item k="Address" v={s.address} wide />
            </dl>
            <div className="divider" />
            <h4 className="text-sm font-semibold text-gray-700">Bank account for salary</h4>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Item k="Bank" v={s.bankName} />
              <Item k="Account title" v={s.bankAccountTitle} />
              <Item k="Account no. / IBAN" v={s.bankAccountNo} />
            </dl>
            <div className="divider" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Item k="App login" v={s.user ? `${s.user.username ?? s.user.email} (${s.user.role.toLowerCase()}${s.user.isActive ? '' : ', disabled'})` : 'None'} />
              <Item k="Class teacher of" v={s.classTeacherOf.map((c: any) => `${c.class.name}-${c.name}`).join(', ')} />
              <Item k="Subjects taught" v={[...new Set(s.subjectsTaught.map((x: any) => `${x.subject.name} (${x.section.class.name}-${x.section.name})`))].join(', ')} wide />
            </dl>
          </div>

          <div className="space-y-4">
            {can(role, 'viewSalary') && <SalaryCard staffId={s.id} current={s.salary ?? null} currency={currency} canEdit={can(role, 'manageSalary') && (s.status === 'ACTIVE' || s.status === 'TEMPORARY_LEAVE')} onEdit={() => setModal('salary')} />}
            <LeaveCard year={s.leave.year} balances={s.leave.balances} />
            <ActivityCard items={s.activity ?? []} extra={s.joiningDate ? [{ label: 'Joined the school', at: s.joiningDate }] : []} />
          </div>

          <div className="card lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="section-title">Documents</h3>
              {manage && <button className="btn btn-secondary px-3 py-1.5 text-sm" onClick={() => setModal('doc')}><Upload className="h-4 w-4" /> Upload</button>}
            </div>
            {s.documents.length === 0 ? <p className="text-sm text-gray-500">Nothing uploaded yet. Add the CNIC copy, degrees, contract or experience letters.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {s.documents.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <a href={d.href} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-2 text-sm text-primary-600 hover:underline">
                      <FileText className="h-4 w-4 flex-shrink-0" /><span className="truncate">{d.title}</span>
                      {d.sizeBytes && <span className="text-xs text-gray-400">{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>}
                    </a>
                    {manage && <DeleteDoc staffId={s.id} doc={d} onDone={refresh} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {s && modal === 'edit' && <EditModal s={s} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'salary' && <SalaryModal staffId={s.id} name={s.name} current={s.salary ?? null} currency={currency} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'doc' && <DocModal staffId={s.id} onClose={() => setModal(null)} onDone={refresh} />}
    </DashboardLayout>
  );
}

function Item({ k, v, wide }: { k: string; v?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="text-xs text-gray-400">{k}</dt>
      <dd className="text-gray-900">{v || '—'}</dd>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-3 py-1 text-sm ${strong ? 'font-semibold' : ''}`}><span className="text-gray-500">{k}</span><span className="text-right text-gray-900">{v}</span></div>;
}

function SalaryCard({ staffId, current, currency, canEdit, onEdit }: { staffId: string; current: SalaryView | null; currency: string; canEdit: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ['hr', 'salary', staffId], queryFn: () => hrAPI.salary(staffId), enabled: showHistory });
  const del = useMutation({
    mutationFn: hrAPI.deleteSalary,
    onSuccess: () => { toast.success('Salary entry removed'); qc.invalidateQueries({ queryKey: ['hr'] }); qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="section-title">Salary</h3>
        {canEdit && <button className="text-xs text-primary-600 hover:underline" onClick={onEdit}>{current ? 'Change / raise' : 'Set salary'}</button>}
      </div>
      {!current ? <p className="text-sm text-gray-500">No salary set yet.</p> : (
        <>
          <Line k="Basic" v={formatMoney(current.basic, currency)} />
          {current.components.filter((c) => c.kind === 'ALLOWANCE').map((c) => <Line key={c.id} k={c.name} v={`+ ${formatMoney(c.amount, currency)}`} />)}
          <Line k="Gross" v={formatMoney(current.gross, currency)} strong />
          {current.components.filter((c) => c.kind === 'DEDUCTION').map((c) => <Line key={c.id} k={c.name} v={<span className="text-red-600">− {formatMoney(c.amount, currency)}</span>} />)}
          <div className="divider my-1" />
          <Line k="Net per month" v={<span className="text-emerald-700">{formatMoney(current.net, currency)}</span>} strong />
          <p className="mt-1 text-xs text-gray-400">Since {formatDate(current.effectiveFrom)}{current.note ? ` · ${current.note}` : ''}</p>
        </>
      )}
      <button className="mt-2 text-xs text-gray-500 hover:underline" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide' : 'Show'} salary history</button>
      {showHistory && (history.isLoading ? <Spinner /> : (
        <ul className="mt-2 space-y-1 text-sm">
          {(history.data?.history ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
              <span>
                <b>{formatMoney(h.net, currency)}</b> net <span className="text-gray-500">from {formatDate(h.effectiveFrom)}</span>
                {h.effectiveFrom > todayIso() && <span className="badge badge-yellow ml-1">upcoming</span>}
                {h.note && <span className="block text-xs text-gray-400">{h.note}</span>}
              </span>
              {canEdit && <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label="Remove this salary entry" onClick={() => confirm('Remove this salary entry? Earlier entries apply again.') && del.mutate(h.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
          {history.data?.history.length === 0 && <li className="text-gray-500">No entries.</li>}
        </ul>
      ))}
    </div>
  );
}

function DeleteDoc({ staffId, doc, onDone }: { staffId: string; doc: any; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => staffAPI.deleteDocument(staffId, doc.id),
    onSuccess: () => { toast.success('Document removed'); onDone(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label={`Remove ${doc.title}`} disabled={m.isPending} onClick={() => confirm(`Remove “${doc.title}”?`) && m.mutate()}><X className="h-3.5 w-3.5" /></button>;
}

function DocModal({ staffId, onClose, onDone }: { staffId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => staffAPI.uploadDocument(staffId, title, file!),
    onSuccess: () => { toast.success('Document added'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Upload document">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (file) m.mutate(); }}>
        <Field label="Title"><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CNIC copy, B.Ed degree, contract…" /></Field>
        <Field label="File" hint="PDF, JPEG, PNG or WebP, up to 5 MB">
          <input type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <button className="btn btn-primary w-full" disabled={m.isPending || !file}>Upload</button>
      </form>
    </Modal>
  );
}

function EditModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const options = useQuery({ queryKey: ['hr', 'options'], queryFn: hrAPI.options });
  const [f, setF] = useState({
    name: s.name ?? '', phone: s.phone ?? '', email: s.email ?? '', designation: s.designation ?? '', department: s.department ?? '',
    qualification: s.qualification ?? '', joiningDate: s.joiningDate ?? '', contractType: s.contractType ?? 'PERMANENT', isTeacher: !!s.isTeacher,
    cnic: s.cnic ?? '', dateOfBirth: s.dateOfBirth ?? '', gender: s.gender ?? '', address: s.address ?? '',
    emergencyContactName: s.emergencyContactName ?? '', emergencyContactPhone: s.emergencyContactPhone ?? '',
    bankName: s.bankName ?? '', bankAccountTitle: s.bankAccountTitle ?? '', bankAccountNo: s.bankAccountNo ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const orNull = (v: string) => (v.trim() ? v.trim() : null);
      return staffAPI.update(s.id, {
        name: f.name, phone: f.phone || undefined, designation: f.designation || undefined, department: f.department || undefined,
        qualification: f.qualification || undefined, ...(f.joiningDate ? { joiningDate: f.joiningDate } : {}),
        contractType: f.contractType, isTeacher: f.isTeacher,
        email: orNull(f.email), cnic: orNull(f.cnic), dateOfBirth: f.dateOfBirth || null, gender: f.gender || null, address: orNull(f.address),
        emergencyContactName: orNull(f.emergencyContactName), emergencyContactPhone: orNull(f.emergencyContactPhone),
        bankName: orNull(f.bankName), bankAccountTitle: orNull(f.bankAccountTitle), bankAccountNo: orNull(f.bankAccountNo),
      });
    },
    onSuccess: () => { toast.success('Profile saved'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${s.name}`} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Name *"><input className="input" required minLength={2} value={f.name} onChange={set('name')} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="input" value={f.email} onChange={set('email')} /></Field>
          <Field label="Designation">
            <input className="input" list="designation-options" value={f.designation} onChange={set('designation')} />
            <datalist id="designation-options">{(options.data?.designations ?? []).map((o) => <option key={o.id} value={o.name} />)}</datalist>
          </Field>
          <Field label="Department">
            <input className="input" list="department-options" value={f.department} onChange={set('department')} />
            <datalist id="department-options">{(options.data?.departments ?? []).map((o) => <option key={o.id} value={o.name} />)}</datalist>
          </Field>
          <Field label="Contract">
            <select className="select" value={f.contractType} onChange={set('contractType')}>
              {Object.entries(CONTRACT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Joining date"><input type="date" className="input" value={f.joiningDate} onChange={set('joiningDate')} /></Field>
          <Field label="Qualification"><input className="input" value={f.qualification} onChange={set('qualification')} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.isTeacher} onChange={(e) => setF({ ...f, isTeacher: e.target.checked })} /> Teaches classes</label>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Personal</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="CNIC"><input className="input" value={f.cnic} onChange={set('cnic')} placeholder="35202-1234567-1" /></Field>
            <Field label="Date of birth"><input type="date" className="input" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></Field>
            <Field label="Gender">
              <select className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select>
            </Field>
            <Field label="Emergency contact name"><input className="input" value={f.emergencyContactName} onChange={set('emergencyContactName')} /></Field>
            <Field label="Emergency contact phone"><input className="input" value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} /></Field>
            <Field label="Address" className="md:col-span-3"><textarea className="input" rows={2} value={f.address} onChange={set('address')} /></Field>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Bank account for salary</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Bank"><input className="input" value={f.bankName} onChange={set('bankName')} /></Field>
            <Field label="Account title"><input className="input" value={f.bankAccountTitle} onChange={set('bankAccountTitle')} /></Field>
            <Field label="Account no. / IBAN"><input className="input" value={f.bankAccountNo} onChange={set('bankAccountNo')} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

type Row = { kind: 'ALLOWANCE' | 'DEDUCTION'; name: string; amount: string };

/** First salary or a raise: basic pay, allowances and fixed deductions from a date. */
function SalaryModal({ staffId, name, current, currency, onClose, onDone }: { staffId: string; name: string; current: SalaryView | null; currency: string; onClose: () => void; onDone: () => void }) {
  const [effectiveFrom, setFrom] = useState(todayIso());
  const [basic, setBasic] = useState(current ? String(Number(current.basic)) : '');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>(current?.components.map((c) => ({ kind: c.kind, name: c.name, amount: String(Number(c.amount)) })) ?? []);
  const num = (v: string) => Number(v) || 0;
  const allowances = rows.filter((r) => r.kind === 'ALLOWANCE').reduce((t, r) => t + num(r.amount), 0);
  const deductions = rows.filter((r) => r.kind === 'DEDUCTION').reduce((t, r) => t + num(r.amount), 0);
  const gross = num(basic) + allowances;
  const m = useMutation({
    mutationFn: () => hrAPI.setSalary(staffId, {
      effectiveFrom, basic: num(basic), note: note || undefined,
      components: rows.filter((r) => r.name.trim() && num(r.amount) > 0).map((r) => ({ kind: r.kind, name: r.name.trim(), amount: num(r.amount) })),
    }),
    onSuccess: () => { toast.success(effectiveFrom > todayIso() ? `Saved. It takes effect on ${formatDate(effectiveFrom)}.` : 'Salary saved'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const section = (kind: Row['kind'], title: string, examples: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setRows([...rows, { kind, name: '', amount: '' }])}><Plus className="inline h-3 w-3" /> Add</button>
      </div>
      {rows.every((r) => r.kind !== kind) && <p className="text-xs text-gray-400">None. {examples}</p>}
      {rows.map((r, i) => r.kind !== kind ? null : (
        <div key={i} className="mb-1.5 grid grid-cols-[1fr_8rem_2rem] gap-2">
          <input className="input py-1.5" placeholder="Name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={`${title} name`} />
          <input type="number" min="0" step="1" className="input py-1.5 text-right" placeholder="Amount" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} aria-label={`${title} amount`} />
          <button type="button" className="btn-icon btn-ghost h-8 w-8 text-red-500" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${current ? 'Change salary' : 'Set salary'} — ${name}`} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Effective from" hint="A later date records a raise that starts then"><input type="date" className="input" required value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Basic pay (monthly) *"><input type="number" min="0" step="1" className="input" required value={basic} onChange={(e) => setBasic(e.target.value)} /></Field>
          <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual increment…" /></Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {section('ALLOWANCE', 'Allowances', 'E.g. house rent, transport, medical.')}
          {section('DEDUCTION', 'Fixed deductions', 'E.g. income tax, EOBI.')}
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <Line k="Gross (basic + allowances)" v={formatMoney(gross, currency)} />
          <Line k="Deductions" v={`− ${formatMoney(deductions, currency)}`} />
          <Line k="Net per month" v={formatMoney(gross - deductions, currency)} strong />
          {deductions > gross && <p className="text-xs text-red-600">Deductions are more than the gross salary.</p>}
        </div>
        <p className="text-xs text-gray-500">Absence and unpaid-leave deductions are worked out each month in payroll, not here.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending || basic === '' || deductions > gross}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
