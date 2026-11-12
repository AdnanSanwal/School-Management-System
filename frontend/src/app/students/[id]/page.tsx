'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { KeyRound, FileText, Plus, Wallet, BadgePercent, Trash2, Camera, Link2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, StatusBadge, SectionSelect } from '@/components/ui/kit';
import { studentsAPI, feesAPI, transportAPI, libraryAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatMoney, sectionLabel, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { LinkedLoginModal, useCreatableRoles } from '@/components/users/LinkedLogin';
import { CredentialsNotice } from '@/components/ui/LoginFields';

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const currency = user?.school?.currency ?? 'PKR';
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ['student', id], queryFn: () => studentsAPI.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['students'] }); };

  const [modal, setModal] = useState<null | 'status' | 'section' | 'doc' | 'concession' | 'fee' | { loginFor: any } | 'studentLogin'>(null);
  const [issued, setIssued] = useState<{ name: string; username: string } | null>(null);
  const mayCreate = useCreatableRoles();
  const manage = can(role, 'manageStudents');

  return (
    <DashboardLayout title={s?.name ?? 'Student'} allowedRoles={CAN.viewStudents}
      subtitle={s ? `${s.admissionNo} · ${sectionLabel(s.section)}` : undefined}
      actions={s && (
        <>
          {can(role, 'collectFees') && <Link href={`/fees?student=${s.id}`} className="btn btn-primary"><Wallet className="h-4 w-4" /> Collect fee</Link>}
          {manage && <button className="btn btn-secondary" onClick={() => setModal('section')}>Change class</button>}
          {manage && <button className="btn btn-secondary" onClick={() => setModal('status')}>Change status</button>}
        </>
      )}>
      {isLoading && <Spinner />}
      {error && <div className="card text-sm text-red-600">{apiError(error, 'Student not found')}</div>}
      {s && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card space-y-2 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Photo s={s} editable={manage} onDone={refresh} />
                <h3 className="section-title">Profile</h3>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Item k="Admission no." v={s.admissionNo} />
              <Item k="Roll no." v={s.rollNo} />
              <Item k="Class" v={sectionLabel(s.section)} />
              <Item k="Class teacher" v={s.section?.classTeacher?.name} />
              <Item k="Gender" v={s.gender?.toLowerCase()} />
              <Item k="Date of birth" v={s.dateOfBirth && formatDate(s.dateOfBirth)} />
              <Item k="Admitted on" v={formatDate(s.admissionDate)} />
              <Item k="Blood group" v={s.bloodGroup} />
              {s.leftOn && <Item k="Left on" v={`${formatDate(s.leftOn)}${s.leftReason ? ` — ${s.leftReason}` : ''}`} />}
              <Item k="Address" v={s.address} wide />
            </dl>
          </div>

          <div className="space-y-4">
            {s.attendance && (
              <div className="card">
                <h3 className="section-title mb-2">Attendance</h3>
                <Line k="This month" v={s.attendance.thisMonth.percent !== null ? `${s.attendance.thisMonth.percent}% of ${s.attendance.thisMonth.total} days` : 'No records'} />
                <Line k="This year" v={s.attendance.thisYear.percent !== null ? `${s.attendance.thisYear.percent}% of ${s.attendance.thisYear.total} days` : 'No records'} />
              </div>
            )}
            {s.fees && (
              <div className="card">
                <h3 className="section-title mb-2">Fees</h3>
                <Line k="Pending" v={<span className={Number(s.fees.pending) > 0 ? 'text-red-600' : 'text-emerald-600'}>{formatMoney(s.fees.pending, currency)}</span>} />
                {s.fees.oldestDueDate && <Line k="Oldest due" v={formatDate(s.fees.oldestDueDate)} />}
                <Line k="Monthly fee" v={
                  <span className="flex items-center gap-2">
                    {s.monthlyFee !== null && s.monthlyFee !== undefined ? formatMoney(s.monthlyFee, currency) : <span className="text-gray-500">Class fee</span>}
                    {can(role, 'setStudentFee') && s.status === 'ACTIVE' && <button className="text-xs text-primary-600 hover:underline" onClick={() => setModal('fee')}>Change</button>}
                  </span>
                } />
                {can(role, 'requestConcession') && (
                  <button className="btn btn-ghost mt-2 w-full" onClick={() => setModal('concession')}><BadgePercent className="h-4 w-4" /> Request concession</button>
                )}
              </div>
            )}
            {can(role, 'viewTransport') && <TransportCard studentId={s.id} active={s.status === 'ACTIVE'} currency={currency} />}
            {can(role, 'viewLibrary') && <LibraryCard studentId={s.id} currency={currency} />}
          </div>

          <div className="card lg:col-span-2">
            <h3 className="section-title mb-3">Guardians</h3>
            <ul className="divide-y divide-slate-100">
              {s.guardians.map((g: any) => (
                <li key={g.guardian.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{g.guardian.name}
                      <span className="ml-2 text-xs text-gray-400">{g.relation.toLowerCase()}{g.isPrimary ? ' · primary' : ''}</span>
                    </p>
                    {g.guardian.phone && <p className="text-gray-500">{g.guardian.phone}{g.guardian.email ? ` · ${g.guardian.email}` : ''}</p>}
                  </div>
                  {g.guardian.user
                    ? <span className="badge badge-green">Login: {g.guardian.user.username ?? g.guardian.user.email}</span>
                    : mayCreate.includes('PARENT') && g.guardian.phone !== undefined && (
                      <button className="btn btn-ghost" onClick={() => setModal({ loginFor: g.guardian })}><KeyRound className="h-4 w-4" /> Create parent login</button>
                    )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
              <div><p className="font-medium">Student’s own login</p><p className="text-xs text-gray-500">Lets {s.name} sign in to the app and see only their own attendance, diary, results and timetable.</p></div>
              {s.user
                ? <span className={`badge ${s.user.isActive ? 'badge-green' : 'badge-gray'}`}>Login: {s.user.username ?? s.user.email}{s.user.isActive ? '' : ' (disabled)'}</span>
                : mayCreate.includes('STUDENT') && s.status === 'ACTIVE'
                  ? <button className="btn btn-ghost" onClick={() => setModal('studentLogin')}><KeyRound className="h-4 w-4" /> Create student login</button>
                  : <span className="text-xs text-gray-400">No login</span>}
            </div>
            {issued && <div className="mt-3"><CredentialsNotice name={issued.name} username={issued.username} onClose={() => setIssued(null)} /></div>}
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="section-title">Documents</h3>
              {manage && <button className="btn-icon btn-ghost" onClick={() => setModal('doc')} aria-label="Add document"><Plus className="h-4 w-4" /></button>}
            </div>
            {s.documents.length === 0 && <p className="text-sm text-gray-500">None uploaded.</p>}
            <ul className="space-y-1.5">
              {s.documents.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <a href={d.href} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-2 text-sm text-primary-600 hover:underline">
                    {d.uploaded ? <FileText className="h-4 w-4 flex-shrink-0" /> : <Link2 className="h-4 w-4 flex-shrink-0" />}
                    <span className="truncate">{d.title}</span>
                    {d.sizeBytes && <span className="text-xs text-gray-400">{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>}
                  </a>
                  {manage && <DeleteDoc studentId={s.id} doc={d} onDone={refresh} />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {s && modal === 'status' && <StatusModal s={s} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'section' && <SectionModal s={s} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'doc' && <DocModal id={s.id} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'concession' && <ConcessionModal id={s.id} onClose={() => setModal(null)} />}
      {s && modal === 'fee' && <MonthlyFeeModal s={s} currency={currency} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal && typeof modal === 'object' && (
        <LinkedLoginModal kind="PARENT" target={modal.loginFor} onClose={() => setModal(null)} onDone={(r) => { setIssued(r); refresh(); }} />
      )}
      {modal === 'studentLogin' && s && <LinkedLoginModal kind="STUDENT" target={{ id: s.id, name: s.name }} onClose={() => setModal(null)} onDone={(r) => { setIssued(r); refresh(); }} />}
    </DashboardLayout>
  );
}

function Item({ k, v, wide }: { k: string; v?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-full' : ''}>
      <dt className="text-xs text-gray-400">{k}</dt>
      <dd className="font-medium text-gray-800">{v || '—'}</dd>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between py-1 text-sm"><span className="text-gray-500">{k}</span><span className="font-medium">{v}</span></div>;
}

function StatusModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: s.status === 'ACTIVE' ? 'LEFT' : 'ACTIVE', date: todayIso(), reason: '' });
  const m = useMutation({
    mutationFn: () => studentsAPI.setStatus(s.id, { status: f.status, date: f.date, reason: f.reason || undefined }),
    onSuccess: () => { toast.success('Status updated'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Change student status">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Status">
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="ACTIVE">Active</option><option value="LEFT">Left school</option>
            <option value="TRANSFERRED">Transferred (TC)</option><option value="GRADUATED">Graduated</option>
          </select>
        </Field>
        {f.status !== 'ACTIVE' && <>
          <Field label="Date"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <p className="text-xs text-gray-500">The student drops out of attendance and fee billing; their app login is disabled.</p>
        </>}
        <button className="btn btn-primary w-full" disabled={m.isPending}>Save</button>
      </form>
    </Modal>
  );
}

function SectionModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [sectionId, setSectionId] = useState(s.sectionId ?? '');
  const m = useMutation({
    mutationFn: () => studentsAPI.update(s.id, { sectionId }),
    onSuccess: () => { toast.success('Class changed'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Change class / section">
      <div className="space-y-3">
        <SectionSelect value={sectionId} onChange={setSectionId} />
        <button className="btn btn-primary w-full" disabled={m.isPending || !sectionId} onClick={() => m.mutate()}>Move student</button>
      </div>
    </Modal>
  );
}

function DocModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const m = useMutation({
    mutationFn: () => (mode === 'file' ? studentsAPI.uploadDocument(id, title, file!) : studentsAPI.addDocumentLink(id, { title, url })),
    onSuccess: () => { toast.success('Document added'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add document">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title"><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Birth certificate" /></Field>
        <div className="flex gap-2 text-sm" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'file'} className={`btn ${mode === 'file' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setMode('file')}>Upload file</button>
          <button type="button" role="tab" aria-selected={mode === 'link'} className={`btn ${mode === 'link' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setMode('link')}>Link</button>
        </div>
        {mode === 'file' ? (
          <Field label="File" hint="PDF, JPEG, PNG or WebP, up to 5 MB">
            <input type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        ) : (
          <Field label="Link"><input type="url" required pattern="https?://.*" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        )}
        <button className="btn btn-primary w-full" disabled={m.isPending || (mode === 'file' && !file)}>{m.isPending ? 'Uploading…' : 'Add'}</button>
      </form>
    </Modal>
  );
}

function DeleteDoc({ studentId, doc, onDone }: { studentId: string; doc: any; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => studentsAPI.deleteDocument(studentId, doc.id),
    onSuccess: () => { toast.success('Document removed'); onDone(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label={`Remove ${doc.title}`} disabled={m.isPending}
      onClick={() => confirm(`Remove “${doc.title}”?`) && m.mutate()}><Trash2 className="h-3.5 w-3.5" /></button>
  );
}

function Photo({ s, editable, onDone }: { s: any; editable: boolean; onDone: () => void }) {
  const m = useMutation({
    mutationFn: (file: File) => studentsAPI.uploadPhoto(s.id, file),
    onSuccess: () => { toast.success('Photo updated'); onDone(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const img = s.photo
    // Plain <img>: the photo is a short-lived signed URL; next/image would proxy and cache it past expiry.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={s.photo} alt={s.name} className="h-14 w-14 rounded-xl object-cover" />
    : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-100 text-lg font-bold text-primary-700">{s.name[0]}</div>;
  if (!editable) return img;
  return (
    <label className="group relative cursor-pointer" title="Change photo">
      {img}
      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Camera className="h-5 w-5 text-white" />
      </span>
      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload student photo"
        disabled={m.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) m.mutate(f); e.target.value = ''; }} />
    </label>
  );
}

function ConcessionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: heads = [] } = useQuery({ queryKey: ['fee-heads'], queryFn: feesAPI.heads });
  const [f, setF] = useState({ feeHeadId: '', type: 'PERCENT', value: '', reason: '', validFrom: todayIso(), validTo: '' });
  const m = useMutation({
    mutationFn: () => feesAPI.requestConcession({
      studentId: id, feeHeadId: f.feeHeadId || null, type: f.type, value: Number(f.value), reason: f.reason,
      validFrom: f.validFrom, validTo: f.validTo || undefined,
    }),
    onSuccess: () => { toast.success('Sent to the principal for approval'); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Request fee concession">
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Fee head" className="col-span-2">
          <select className="select" value={f.feeHeadId} onChange={(e) => setF({ ...f, feeHeadId: e.target.value })}>
            <option value="">All fee heads</option>
            {heads.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="PERCENT">Percent off</option><option value="FIXED">Fixed amount off</option>
          </select>
        </Field>
        <Field label={f.type === 'PERCENT' ? 'Percent' : 'Amount'}>
          <input type="number" min="0.01" step="0.01" max={f.type === 'PERCENT' ? 100 : undefined} required className="input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </Field>
        <Field label="From"><input type="date" required className="input" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
        <Field label="Until (optional)"><input type="date" className="input" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
        <Field label="Reason" className="col-span-2"><input required minLength={3} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <button className="btn btn-primary col-span-2" disabled={m.isPending}>Send for approval</button>
      </form>
    </Modal>
  );
}

function TransportCard({ studentId, active, currency }: { studentId: string; active: boolean; currency: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageTransport') && active;
  const qc = useQueryClient();
  const t = useQuery({ queryKey: ['transport', 'student', studentId], queryFn: () => transportAPI.student(studentId) });
  const routes = useQuery({ queryKey: ['transport', 'routes'], queryFn: transportAPI.routes, enabled: manage });
  const [editing, setEditing] = useState(false);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] });
  const assign = useMutation({
    mutationFn: () => transportAPI.assign(studentId, routeId, stopId || null),
    onSuccess: () => { toast.success('Transport saved'); setEditing(false); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: () => transportAPI.unassign(studentId),
    onSuccess: () => { toast.success('Removed from transport'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const cur: any = t.data;
  const route = (routes.data ?? []).find((r: any) => r.id === routeId);

  return (
    <div className="card">
      <h3 className="section-title mb-2">Transport</h3>
      {t.isLoading ? <Spinner /> : editing ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
          <select className="select" required value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(''); }} aria-label="Route">
            <option value="" disabled>Choose route…</option>
            {(routes.data ?? []).filter((r: any) => r.isActive).map((r: any) => (
              <option key={r.id} value={r.id}>{r.name} · {formatMoney(r.monthlyFee, currency)}{r.capacity ? ` · ${r.riders}/${r.capacity}` : ''}</option>
            ))}
          </select>
          {route?.stops.length > 0 && (
            <select className="select" value={stopId} onChange={(e) => setStopId(e.target.value)} aria-label="Stop">
              <option value="">No particular stop</option>
              {route.stops.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.pickupTime ? ` (${s.pickupTime})` : ''}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={assign.isPending}>Save</button>
          </div>
        </form>
      ) : cur ? (
        <>
          <Line k="Route" v={cur.route.name} />
          {cur.stop && <Line k="Stop" v={`${cur.stop.name}${cur.stop.pickupTime ? ` · ${cur.stop.pickupTime}` : ''}`} />}
          {cur.route.vehicleNo && <Line k="Vehicle" v={cur.route.vehicleNo} />}
          <Line k="Monthly fee" v={formatMoney(cur.route.monthlyFee, currency)} />
          {manage && (
            <div className="mt-2 flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => { setRouteId(cur.route.id); setEditing(true); }}>Change</button>
              <button className="btn btn-ghost flex-1 text-red-600" onClick={() => confirm('Remove from school transport? The fee stops from the next invoice.') && remove.mutate()}>Remove</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-gray-500">Does not use school transport.</p>
          {manage && <button className="btn btn-ghost mt-2 w-full" onClick={() => setEditing(true)}>Assign a route</button>}
        </>
      )}
    </div>
  );
}

function LibraryCard({ studentId, currency }: { studentId: string; currency: string }) {
  const q = useQuery({ queryKey: ['library', 'student', studentId], queryFn: () => libraryAPI.student(studentId) });
  const d: any = q.data;
  return (
    <div className="card">
      <h3 className="section-title mb-2">Library</h3>
      {q.isLoading ? <Spinner /> : !d ? null : (
        <>
          {!d.current.length ? <p className="text-sm text-gray-500">No books issued.</p> : (
            <ul className="space-y-1 text-sm">
              {d.current.map((l: any) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">{l.book.title}</span>
                  <span className={l.overdue ? 'whitespace-nowrap text-red-600' : 'whitespace-nowrap text-gray-500'}>due {formatDate(l.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
          {d.unpaidFines > 0 && <Line k="Unpaid fines" v={<span className="text-red-600">{formatMoney(d.unpaidFines, currency)}</span>} />}
          <p className="mt-1 text-xs text-gray-400">{d.history.length} book(s) returned before</p>
        </>
      )}
    </div>
  );
}

/** CR-04: change a student's own monthly fee, or go back to the class fee structure. */
function MonthlyFeeModal({ s, currency, onClose, onDone }: { s: any; currency: string; onClose: () => void; onDone: () => void }) {
  const [fee, setFee] = useState(s.monthlyFee !== null && s.monthlyFee !== undefined ? String(Number(s.monthlyFee)) : '');
  const save = useMutation({
    mutationFn: (value: number | null) => studentsAPI.setMonthlyFee(s.id, value),
    onSuccess: (_r, value) => { toast.success(value === null ? 'Now billed from the class fee structure' : `Monthly fee set to ${formatMoney(value, currency)}`); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Monthly fee — ${s.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(Number(fee)); }}>
        <Field label="Monthly Fee" hint="Replaces the class's monthly charges on invoices generated from now on. Annual charges, transport and concessions still apply.">
          <input type="number" min="0" step="1" required className="input" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-between gap-2">
          {s.monthlyFee !== null && s.monthlyFee !== undefined && (
            <button type="button" className="btn btn-ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>Use the class fee instead</button>
          )}
          <button className="btn btn-primary ml-auto" disabled={save.isPending || fee === ''}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
