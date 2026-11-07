'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { KeyRound, FileText, Plus, Wallet, BadgePercent } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, StatusBadge, SectionSelect } from '@/components/ui/kit';
import { studentsAPI, feesAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatMoney, sectionLabel, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const currency = user?.school?.currency ?? 'PKR';
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ['student', id], queryFn: () => studentsAPI.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['students'] }); };

  const [modal, setModal] = useState<null | 'status' | 'section' | 'doc' | 'concession' | { loginFor: any }>(null);
  const [issued, setIssued] = useState<any>(null);
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
              <h3 className="section-title">Profile</h3>
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
                {can(role, 'requestConcession') && (
                  <button className="btn btn-ghost mt-2 w-full" onClick={() => setModal('concession')}><BadgePercent className="h-4 w-4" /> Request concession</button>
                )}
              </div>
            )}
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
                    ? <span className="badge badge-green">App: {g.guardian.user.email}</span>
                    : can(role, 'manageUsers') && g.guardian.phone !== undefined && (
                      <button className="btn btn-ghost" onClick={() => setModal({ loginFor: g.guardian })}><KeyRound className="h-4 w-4" /> Give app access</button>
                    )}
                </li>
              ))}
            </ul>
            {issued && <div className="mt-3"><PasswordNotice email={issued.user.email} password={issued.temporaryPassword} /></div>}
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="section-title">Documents</h3>
              {manage && <button className="btn-icon btn-ghost" onClick={() => setModal('doc')} aria-label="Add document"><Plus className="h-4 w-4" /></button>}
            </div>
            {s.documents.length === 0 && <p className="text-sm text-gray-500">None uploaded.</p>}
            <ul className="space-y-1.5">
              {s.documents.map((d: any) => (
                <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary-600 hover:underline"><FileText className="h-4 w-4" />{d.title}</a></li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {s && modal === 'status' && <StatusModal s={s} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'section' && <SectionModal s={s} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'doc' && <DocModal id={s.id} onClose={() => setModal(null)} onDone={refresh} />}
      {s && modal === 'concession' && <ConcessionModal id={s.id} onClose={() => setModal(null)} />}
      {s && modal && typeof modal === 'object' && (
        <LoginModal guardian={modal.loginFor} onClose={() => setModal(null)} onDone={(r) => { setIssued(r); refresh(); }} />
      )}
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
  const [f, setF] = useState({ title: '', url: '' });
  const m = useMutation({
    mutationFn: () => studentsAPI.addDocument(id, f),
    onSuccess: () => { toast.success('Document added'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add document">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title"><input className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Birth certificate" /></Field>
        <Field label="Link" hint="File uploads come later; paste a link to the scanned document for now">
          <input type="url" className="input" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        </Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Add</button>
      </form>
    </Modal>
  );
}

function LoginModal({ guardian, onClose, onDone }: { guardian: any; onClose: () => void; onDone: (r: any) => void }) {
  const [email, setEmail] = useState(guardian.email ?? '');
  const m = useMutation({
    mutationFn: () => studentsAPI.guardianLogin(guardian.id, email),
    onSuccess: (r) => { onDone(r); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`App access for ${guardian.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Login email"><input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <p className="text-xs text-gray-500">One login covers all their children at this school.</p>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Create login</button>
      </form>
    </Modal>
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
