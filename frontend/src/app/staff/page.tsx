'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, KeyRound, UserMinus, UserCheck } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, Empty } from '@/components/ui/kit';
import { staffAPI, hrAPI, apiError, type UsernameCheck } from '@/lib/api';
import { LoginFields, CredentialsNotice, emptyLogin, loginBody, loginProblems, type LoginValue } from '@/components/ui/LoginFields';
import { useCreatableRoles } from '@/components/users/LinkedLogin';
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
    meta: { quiet: !!search },
    queryFn: () => staffAPI.list({ status, search: search || undefined, limit: 200 }),
  });
  const markLeft = useMutation({
    mutationFn: (id: string) => staffAPI.update(id, { status: 'LEFT' }),
    onSuccess: () => { toast.success('Marked as left; login disabled'); for (const key of ['staff', 'teachers', 'classes', 'users']) qc.invalidateQueries({ queryKey: [key] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => staffAPI.update(id, { status: 'ACTIVE' }),
    onSuccess: (r: any) => {
      toast.success(`${r.name} is active again${r.userId ? '; their login works again' : ''}. Reassign their classes if needed.`, { duration: 6000 });
      for (const key of ['staff', 'teachers', 'classes', 'users']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Staff" allowedRoles={CAN.viewStaff} subtitle={data ? `${data.pagination.total} people` : undefined}
      actions={manage && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add staff</button>}>
      {issued && (issued.temporaryPassword
        ? <PasswordNotice email={issued.user.username ?? issued.user.email} password={issued.temporaryPassword} />
        : <CredentialsNotice name={issued.user.name} username={issued.user.username ?? issued.user.email} onClose={() => setIssued(null)} />)}
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
                    <td className="font-medium"><Link href={`/staff/${s.id}`} className="text-primary-700 hover:underline">{s.name}</Link></td>
                    <td className="font-mono text-sm">{s.employeeNo}</td>
                    <td className="text-sm">{s.designation ?? (s.isTeacher ? 'Teacher' : '—')}</td>
                    <td className="text-sm">{s.classTeacherOf.map((c: any) => `${c.class.name}-${c.name}`).join(', ') || '—'}</td>
                    <td className="text-sm">{s.phone ?? '—'}</td>
                    <td className="text-sm">{s.user ? <span className="inline-flex flex-col"><span className={s.user.isActive ? 'badge badge-green w-fit' : 'badge badge-gray w-fit'}>{s.user.role.toLowerCase()}</span>{(s.user.username || s.user.email) && <span className="mt-0.5 font-mono text-xs text-gray-500">{s.user.username ?? s.user.email}</span>}</span>
                      : manage && s.status === 'ACTIVE' ? <button className="btn btn-ghost px-2 py-1" onClick={() => setLoginFor(s)}><KeyRound className="h-3.5 w-3.5" /> Give access</button> : '—'}</td>
                    {manage && <td>{s.status === 'ACTIVE' ? (
                      <button className="btn-icon btn-ghost text-red-500" aria-label={`Mark ${s.name} as left`} title="Mark as left"
                        onClick={() => confirm(`Mark ${s.name} as left? Their login will be disabled.`) && markLeft.mutate(s.id)}><UserMinus className="h-4 w-4" /></button>
                    ) : (
                      <button className="btn btn-ghost px-2 py-1 text-xs text-emerald-700" disabled={reactivate.isPending}
                        onClick={() => confirm(`Reactivate ${s.name}?${s.user ? ' Their login will work again.' : ''}`) && reactivate.mutate(s.id)}>
                        <UserCheck className="h-3.5 w-3.5" /> Reactivate
                      </button>
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

const ALL_LOGIN_ROLES = [['TEACHER', 'Teacher'], ['ACCOUNTANT', 'Accountant'], ['ADMIN', 'Office admin'], ['PRINCIPAL', 'Principal']];
/** Roles this user may give out (the owner decides this under Roles & permissions). */
function useLoginRoles() {
  const mine = useCreatableRoles();
  return ALL_LOGIN_ROLES.filter(([r]) => mine.includes(r));
}

function AddStaffModal({ onClose, onIssued }: { onClose: () => void; onIssued: (r: any) => void }) {
  const qc = useQueryClient();
  const roles = useLoginRoles();
  const options = useQuery({ queryKey: ['hr', 'options'], queryFn: hrAPI.options });
  const [f, setF] = useState({ name: '', phone: '', designation: 'Teacher', department: '', qualification: '', joiningDate: '', isTeacher: true });
  const [withLogin, setWithLogin] = useState(true);
  const [login, setLogin] = useState<LoginValue>(emptyLogin(roles[0]?.[0] ?? 'TEACHER'));
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const problems = withLogin ? loginProblems(login, check) : [];
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => staffAPI.create({
      name: f.name, phone: f.phone || undefined, designation: f.designation || undefined, department: f.department || undefined,
      qualification: f.qualification || undefined, joiningDate: f.joiningDate || undefined, isTeacher: f.isTeacher,
      login: withLogin ? loginBody(login) : undefined,
    }),
    onSuccess: (r: any) => { toast.success(`${r.staff.name} added (${r.staff.employeeNo})`); if (r.login) onIssued(r.login); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add staff member" wide>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (problems.length) return toast.error(problems[0]); m.mutate(); }}>
        <Field label="Staff name *"><input className="input" required minLength={2} value={f.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Role / designation">
          <input className="input" list="add-designations" value={f.designation} onChange={set('designation')} placeholder="Teacher, Clerk, Driver…" />
          <datalist id="add-designations">{(options.data?.designations ?? []).map((o) => <option key={o.id} value={o.name} />)}</datalist>
        </Field>
        <Field label="Department">
          <input className="input" list="add-departments" value={f.department} onChange={set('department')} />
          <datalist id="add-departments">{(options.data?.departments ?? []).map((o) => <option key={o.id} value={o.name} />)}</datalist>
        </Field>
        <Field label="Qualification"><input className="input" value={f.qualification} onChange={set('qualification')} /></Field>
        <Field label="Joining date"><input type="date" className="input" value={f.joiningDate} onChange={set('joiningDate')} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={f.isTeacher} onChange={(e) => setF({ ...f, isTeacher: e.target.checked })} /> Teaches classes</label>
        <div className="rounded-xl bg-slate-50 p-3 md:col-span-2">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} /> Login credentials (lets them use the app)
          </label>
          {withLogin && <LoginFields value={login} onChange={setLogin} roles={roles} personName={f.name} onCheck={setCheck} />}
        </div>
        <button className="btn btn-primary md:col-span-2" disabled={m.isPending || problems.length > 0} title={problems[0]}>Add staff member</button>
      </form>
    </Modal>
  );
}

function LoginModal({ staff, onClose, onIssued }: { staff: any; onClose: () => void; onIssued: (r: any) => void }) {
  const qc = useQueryClient();
  const roles = useLoginRoles();
  const [login, setLogin] = useState<LoginValue>(emptyLogin(staff.isTeacher ? 'TEACHER' : (roles.find(([r]) => r === 'ACCOUNTANT')?.[0] ?? roles[0]?.[0] ?? 'TEACHER')));
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const problems = loginProblems(login, check);
  const m = useMutation({
    mutationFn: () => staffAPI.createLogin(staff.id, loginBody(login)),
    onSuccess: (r) => { onIssued(r); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Login credentials for ${staff.name}`} wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (problems.length) return toast.error(problems[0]); m.mutate(); }}>
        <LoginFields value={login} onChange={setLogin} roles={roles} personName={staff.name} onCheck={setCheck} />
        <button className="btn btn-primary w-full" disabled={m.isPending || problems.length > 0} title={problems[0]}>Create login</button>
      </form>
    </Modal>
  );
}
