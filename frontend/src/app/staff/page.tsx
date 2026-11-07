'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, KeyRound, UserMinus } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, Empty } from '@/components/ui/kit';
import { staffAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';

export default function StaffPage() {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageStaff');
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [loginFor, setLoginFor] = useState<any>(null);
  const [issued, setIssued] = useState<any>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['staff', status, search],
    queryFn: () => staffAPI.list({ status, search: search || undefined, limit: 200 }),
  });
  const markLeft = useMutation({
    mutationFn: (id: string) => staffAPI.update(id, { status: 'LEFT' }),
    onSuccess: () => { toast.success('Marked as left; login disabled'); qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Staff" allowedRoles={CAN.viewStaff} subtitle={data ? `${data.pagination.total} people` : undefined}
      actions={manage && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add staff</button>}>
      {issued && <PasswordNotice email={issued.user.email} password={issued.temporaryPassword} />}
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-3">
          <input className="input max-w-xs" placeholder="Search name, employee no., phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
          <select className="select w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="ACTIVE">Active</option><option value="LEFT">Left</option>
          </select>
        </div>
        {isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="No staff found" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Name</th><th>Emp. no.</th><th>Designation</th><th>Class teacher of</th><th>Phone</th><th>App login</th>{manage && <th />}</tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td className="font-mono text-sm">{s.employeeNo}</td>
                    <td className="text-sm">{s.designation ?? (s.isTeacher ? 'Teacher' : '—')}</td>
                    <td className="text-sm">{s.classTeacherOf.map((c: any) => `${c.class.name}-${c.name}`).join(', ') || '—'}</td>
                    <td className="text-sm">{s.phone ?? '—'}</td>
                    <td className="text-sm">{s.user ? <span className={s.user.isActive ? 'badge badge-green' : 'badge badge-gray'}>{s.user.role.toLowerCase()}</span>
                      : manage && s.status === 'ACTIVE' ? <button className="btn btn-ghost px-2 py-1" onClick={() => setLoginFor(s)}><KeyRound className="h-3.5 w-3.5" /> Give access</button> : '—'}</td>
                    {manage && <td>{s.status === 'ACTIVE' && (
                      <button className="btn-icon btn-ghost text-red-500" aria-label={`Mark ${s.name} as left`}
                        onClick={() => confirm(`Mark ${s.name} as left? Their login will be disabled.`) && markLeft.mutate(s.id)}><UserMinus className="h-4 w-4" /></button>
                    )}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddStaffModal onClose={() => setAdding(false)} onIssued={setIssued} />}
      {loginFor && <LoginModal staff={loginFor} onClose={() => setLoginFor(null)} onIssued={setIssued} />}
    </DashboardLayout>
  );
}

const loginRoles = [['TEACHER', 'Teacher'], ['ACCOUNTANT', 'Accountant'], ['ADMIN', 'Office admin'], ['PRINCIPAL', 'Principal']];

function AddStaffModal({ onClose, onIssued }: { onClose: () => void; onIssued: (r: any) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', phone: '', designation: 'Teacher', department: '', qualification: '', joiningDate: '', isTeacher: true, loginEmail: '', loginRole: 'TEACHER' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => staffAPI.create({
      name: f.name, phone: f.phone || undefined, designation: f.designation || undefined, department: f.department || undefined,
      qualification: f.qualification || undefined, joiningDate: f.joiningDate || undefined, isTeacher: f.isTeacher,
      login: f.loginEmail ? { email: f.loginEmail, role: f.loginRole } : undefined,
    }),
    onSuccess: (r: any) => { toast.success(`${r.staff.name} added (${r.staff.employeeNo})`); if (r.login) onIssued(r.login); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add staff member" wide>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name *"><input className="input" required minLength={2} value={f.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Designation"><input className="input" value={f.designation} onChange={set('designation')} /></Field>
        <Field label="Department"><input className="input" value={f.department} onChange={set('department')} /></Field>
        <Field label="Qualification"><input className="input" value={f.qualification} onChange={set('qualification')} /></Field>
        <Field label="Joining date"><input type="date" className="input" value={f.joiningDate} onChange={set('joiningDate')} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={f.isTeacher} onChange={(e) => setF({ ...f, isTeacher: e.target.checked })} /> Teaches classes</label>
        <div className="rounded-xl bg-slate-50 p-3 md:col-span-2">
          <p className="mb-2 text-sm font-medium">App login (optional)</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Login email"><input type="email" className="input" value={f.loginEmail} onChange={set('loginEmail')} /></Field>
            <Field label="Role"><select className="select" value={f.loginRole} onChange={set('loginRole')}>{loginRoles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
        </div>
        <button className="btn btn-primary md:col-span-2" disabled={m.isPending}>Add</button>
      </form>
    </Modal>
  );
}

function LoginModal({ staff, onClose, onIssued }: { staff: any; onClose: () => void; onIssued: (r: any) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: '', role: staff.isTeacher ? 'TEACHER' : 'ACCOUNTANT' });
  const m = useMutation({
    mutationFn: () => staffAPI.createLogin(staff.id, f),
    onSuccess: (r) => { onIssued(r); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`App access for ${staff.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Login email"><input type="email" required className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{loginRoles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Create login</button>
      </form>
    </Modal>
  );
}
