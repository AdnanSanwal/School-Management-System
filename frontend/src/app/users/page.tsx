'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, KeyRound } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, Empty } from '@/components/ui/kit';
import { SearchInput, NoMatches, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { usersAPI, apiError, type UsernameCheck } from '@/lib/api';
import { LoginFields, CredentialsNotice, emptyLogin, loginBody, loginProblems, type LoginValue } from '@/components/ui/LoginFields';
import { CAN, ROLE_LABEL, customRoleOptions, roleName, splitRole } from '@/lib/roles';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

import { StudentOrParentLogin, TeacherLogin, useCreatableRoles, type Issued } from '@/components/users/LinkedLogin';
const RANK: Record<string, number> = { OWNER: 50, PRINCIPAL: 40, ADMIN: 30, ACCOUNTANT: 20, TEACHER: 20, PARENT: 10, STUDENT: 10 };

export default function UsersPage() {
  return <Suspense fallback={null}><Users /></Suspense>;
}

function Users() {
  const me = useAuthStore((s) => s.user);
  const mine = useCreatableRoles();
  const manageable = (_me: string, target: string) => mine.includes(target);
  const [role, setRole] = useState('');
  // The header search links here as /users?search=<username>.
  const initialSearch = useSearchParams().get('search') ?? '';
  const [search, setSearch] = useState(initialSearch);
  const term = useDebounced(cleanTerm(search), 250);
  const [page, setPage] = useState(1);
  const [linked, setLinked] = useState(initialSearch);
  if (linked !== initialSearch) { setLinked(initialSearch); setSearch(initialSearch); setPage(1); }
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password?: string; name?: string } | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users', role, term, page],
    meta: { quiet: !!term },
    placeholderData: keepPreviousData,
    queryFn: () => usersAPI.list({ role: role || undefined, search: term || undefined, page, limit: 50 }),
  });
  // Staff roles this user may give out, plus the school's own roles built on them.
  const staffRoles = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'].filter((r) => mine.includes(r));
  const roleChoices = [...staffRoles.map((r) => [r, ROLE_LABEL[r]]), ...customRoleOptions(staffRoles)];
  const changeRole = useMutation({
    mutationFn: ({ u, value }: { u: any; value: string }) => usersAPI.update(u.id, splitRole(value)),
    onSuccess: (r: any) => { toast.success(`${r.name} is now ${roleName(r)}`); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: any) => usersAPI.update(u.id, { isActive: !u.isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Updated'); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reset = useMutation({
    mutationFn: (u: any) => usersAPI.resetPassword(u.id).then((r) => ({ ...r, email: u.username ?? u.email })),
    onSuccess: (r) => setIssued({ email: r.email, password: r.temporaryPassword }),
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Users & logins" allowedRoles={CAN.manageUsers} subtitle="Who can sign in to the school's ERP"
      actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add login</button>}>
      {issued && (issued.password
        ? <PasswordNotice email={issued.email} password={issued.password} />
        : <CredentialsNotice name={issued.name ?? issued.email} username={issued.email} onClose={() => setIssued(null)} />)}
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-3">
          <SearchInput className="w-72 max-w-full" placeholder="Name, username, email, phone" value={search} onChange={(v) => { setSearch(v); setPage(1); }} aria-label="Search users" />
          <select className="select w-44" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role">
            <option value="">All roles</option>
            {Object.keys(RANK).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        {isLoading ? <Spinner /> : rows.length === 0 ? (term ? <NoMatches term={term} what="users" onClear={() => setSearch('')} /> : <Empty title="No users" />) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Name</th><th>Username / email</th><th>Role</th><th>Last login</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const can = me && u.id !== me.id && manageable(me.role, u.role);
                  return (
                    <tr key={u.id}>
                      <td className="font-medium">{u.name}</td>
                      <td className="text-sm">
                        {u.username && <span className="block font-mono">{u.username}</span>}
                        {u.email && <span className={u.username ? 'block text-xs text-gray-500' : ''}>{u.email}</span>}
                        {u.mustChangePassword && <span className="badge badge-yellow mt-0.5">must set own password</span>}
                      </td>
                      <td className="text-sm">{can && staffRoles.includes(u.role) && roleChoices.length > 1 ? (
                        <select className="select py-1 text-sm" aria-label={`Role of ${u.name}`} disabled={changeRole.isPending}
                          value={u.customRole ? `${u.role}:${u.customRole.id}` : u.role}
                          onChange={(e) => {
                            const value = e.target.value;
                            const label = roleChoices.find(([v]) => v === value)?.[1] ?? value;
                            if (window.confirm(`Change ${u.name}'s role to ${label}? They get that role's permissions straight away.`)) changeRole.mutate({ u, value });
                          }}>
                          {roleChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : roleName(u)}</td>
                      <td className="text-sm text-gray-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                      <td>{can ? (
                        <button className={`badge ${u.isActive ? 'badge-green' : 'badge-gray'}`} onClick={() => toggle.mutate(u)} title="Click to toggle">
                          {u.isActive ? 'active' : 'disabled'}
                        </button>
                      ) : <span className={`badge ${u.isActive ? 'badge-green' : 'badge-gray'}`}>{u.isActive ? 'active' : 'disabled'}</span>}</td>
                      <td>{can && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Reset password for ${u.username ?? u.email}?`) && reset.mutate(u)}><KeyRound className="h-3.5 w-3.5" /> Reset password</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && (data.pagination?.pages ?? 1) > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                <span className="text-gray-500">{data.pagination.total} users · page {page} of {data.pagination.pages}</span>
                <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn btn-ghost" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        )}
      </div>
      {adding && me && <AddUserModal myRole={me.role} onClose={() => setAdding(false)} onIssued={setIssued} />}
    </DashboardLayout>
  );
}

const KIND_LABEL: Record<string, [string, string]> = {
  OFFICE: ['Office user', 'Owner, principal, office admin or accountant'],
  TEACHER: ['Teacher', 'Someone already on the staff list'],
  PARENT: ['Parent', 'A guardian of a student'],
  STUDENT: ['Student', 'The student’s own login'],
};

function AddUserModal({ onClose, onIssued }: { myRole: string; onClose: () => void; onIssued: (v: { email: string; password?: string; name?: string }) => void }) {
  const qc = useQueryClient();
  const mine = useCreatableRoles();
  const roles = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'].filter((r) => mine.includes(r));
  const kinds = [roles.length ? 'OFFICE' : '', ...['TEACHER', 'PARENT', 'STUDENT'].filter((r) => mine.includes(r))].filter(Boolean);
  const [kind, setKind] = useState(kinds[0] ?? 'OFFICE');
  const linked = (r: Issued) => { onIssued({ email: r.username, name: r.name }); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['student'] }); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); };
  const [f, setF] = useState({ name: '', phone: '' });
  const [login, setLogin] = useState<LoginValue>(emptyLogin(roles[roles.length - 1] ?? 'ACCOUNTANT'));
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const problems = loginProblems(login, check);
  const m = useMutation({
    mutationFn: () => usersAPI.create({ name: f.name, phone: f.phone || undefined, ...loginBody(login) }),
    onSuccess: (r: any) => { onIssued({ email: r.user.username ?? r.user.email, name: r.user.name }); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add login" wide>
      <div className="mb-4 grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Who is the login for?">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${kind === k ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <span className="font-medium">{KIND_LABEL[k][0]}</span><span className="block text-xs text-gray-500">{KIND_LABEL[k][1]}</span>
          </button>
        ))}
      </div>
      {kinds.length === 0 && <p className="text-sm text-gray-500">Your role is not allowed to create logins. The owner can change this under Roles &amp; permissions.</p>}
      {kind === 'TEACHER' && <TeacherLogin onDone={linked} />}
      {(kind === 'PARENT' || kind === 'STUDENT') && <StudentOrParentLogin key={kind} kind={kind} onDone={linked} />}
      {kind === 'OFFICE' && roles.length > 0 && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (problems.length) return toast.error(problems[0]); m.mutate(); }}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name *"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <LoginFields value={login} onChange={setLogin} roles={[...roles.map((r) => [r, ROLE_LABEL[r]]), ...customRoleOptions(roles)]} personName={f.name} onCheck={setCheck} />
        <button className="btn btn-primary w-full" disabled={m.isPending || problems.length > 0} title={problems[0]}>Create</button>
      </form>}
    </Modal>
  );
}
