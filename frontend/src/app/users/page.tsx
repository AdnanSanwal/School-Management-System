'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, KeyRound } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, PasswordNotice, Spinner, Empty } from '@/components/ui/kit';
import { usersAPI, apiError } from '@/lib/api';
import { CAN, ROLE_LABEL } from '@/lib/roles';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const RANK: Record<string, number> = { OWNER: 50, PRINCIPAL: 40, ADMIN: 30, ACCOUNTANT: 20, TEACHER: 20, PARENT: 10, STUDENT: 10 };
const manageable = (me: string, target: string) => me === 'OWNER' || (RANK[me] ?? 0) > (RANK[target] ?? 99);

export default function UsersPage() {
  const me = useAuthStore((s) => s.user);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users', role, search, page],
    meta: { quiet: !!search },
    queryFn: () => usersAPI.list({ role: role || undefined, search: search || undefined, page, limit: 50 }),
  });
  const toggle = useMutation({
    mutationFn: (u: any) => usersAPI.update(u.id, { isActive: !u.isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Updated'); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reset = useMutation({
    mutationFn: (u: any) => usersAPI.resetPassword(u.id).then((r) => ({ ...r, email: u.email })),
    onSuccess: (r) => setIssued({ email: r.email, password: r.temporaryPassword }),
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Users & logins" allowedRoles={CAN.manageUsers} subtitle="Who can sign in to the school's ERP"
      actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Office user</button>}>
      {issued && <PasswordNotice email={issued.email} password={issued.password} />}
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-3">
          <input className="input max-w-xs" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          <select className="select w-44" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">All roles</option>
            {Object.keys(RANK).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        {isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="No users" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const can = me && u.id !== me.id && manageable(me.role, u.role);
                  return (
                    <tr key={u.id}>
                      <td className="font-medium">{u.name}</td>
                      <td className="text-sm">{u.email}</td>
                      <td className="text-sm">{ROLE_LABEL[u.role]}</td>
                      <td className="text-sm text-gray-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                      <td>{can ? (
                        <button className={`badge ${u.isActive ? 'badge-green' : 'badge-gray'}`} onClick={() => toggle.mutate(u)} title="Click to toggle">
                          {u.isActive ? 'active' : 'disabled'}
                        </button>
                      ) : <span className={`badge ${u.isActive ? 'badge-green' : 'badge-gray'}`}>{u.isActive ? 'active' : 'disabled'}</span>}</td>
                      <td>{can && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Reset password for ${u.email}?`) && reset.mutate(u)}><KeyRound className="h-3.5 w-3.5" /> Reset password</button>}</td>
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

function AddUserModal({ myRole, onClose, onIssued }: { myRole: string; onClose: () => void; onIssued: (v: { email: string; password: string }) => void }) {
  const qc = useQueryClient();
  const roles = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'].filter((r) => manageable(myRole, r));
  const [f, setF] = useState({ name: '', email: '', phone: '', role: roles[roles.length - 1] ?? 'ACCOUNTANT' });
  const m = useMutation({
    mutationFn: () => usersAPI.create({ ...f, phone: f.phone || undefined }),
    onSuccess: (r: any) => { onIssued({ email: r.user.email, password: r.temporaryPassword }); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add office user">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-xs text-gray-500">Teacher, parent and student logins are created from the Staff page and the student profile, so they stay linked to the right record.</p>
        <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Role"><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Create</button>
      </form>
    </Modal>
  );
}
