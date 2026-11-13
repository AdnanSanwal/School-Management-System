'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiError, brandsAPI, platformAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Field, Modal, Spinner } from '@/components/ui/kit';
import { formatMoney, formatDate } from '@/lib/utils';

export function BrandConsole() {
  const platform = useAuthStore(s => s.user?.role === 'SUPER_ADMIN');
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: ['brands'], queryFn: brandsAPI.list });
  const [dialog, setDialog] = useState<{ kind: string; brand?: any } | null>(null);
  const [selected, setSelected] = useState('');
  const brand = brands.data?.find((b: any) => b.id === selected) ?? brands.data?.[0];
  const summary = useQuery({ queryKey: ['brand-summary', brand?.id], queryFn: () => brandsAPI.summary(brand.id), enabled: !!brand && !platform });
  const toggleBrand = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => brandsAPI.update(id, { isActive }), onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }), onError: e => toast.error(apiError(e)) });
  const change = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => platformAPI.setActive(id, active), onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }), onError: e => toast.error(apiError(e)) });
  if (brands.isLoading) return <Spinner />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-bold">{platform ? 'Brands & branches' : 'All branches'}</h2><p className="text-sm text-gray-500">One brand licence sets the branch count and active student limit per branch.</p></div>
      {platform && <button className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>New brand</button>}
    </div>
    {brands.error && <p className="text-red-600">{apiError(brands.error)}</p>}
    {!brands.data?.length ? <p className="card">No brands assigned.</p> : <>
      <Field label="Brand"><select className="input max-w-md" value={brand?.id ?? ''} onChange={e => setSelected(e.target.value)}>{brands.data.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      {brand && <>
        <div className="card space-y-4">
          <div className="min-w-0"><h3 className="font-bold">{brand.name}</h3><p className="text-sm text-gray-500">{brand.licence.summary}</p><p className="text-sm mt-1">Branches: {brand.branches.length} / {brand.maxBranches ?? 'Unlimited'} · Students per branch: {brand.maxStudents ?? 'Unlimited'}</p><p className="text-xs text-gray-500 mt-1">Owners: {brand.owners.map((o: any) => o.name).join(', ')}</p></div>
          <div className="flex flex-wrap items-center gap-2"><button className="btn btn-secondary" onClick={() => setDialog({ kind: 'branding', brand })}>Brand settings</button>
          <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'access', brand })}>Staff branch access</button>
          {platform && <><button className="btn btn-secondary" disabled={toggleBrand.isPending} onClick={() => toggleBrand.mutate({ id: brand.id, isActive: !brand.isActive })}>{brand.isActive ? 'Suspend brand' : 'Activate brand'}</button><button className="btn btn-secondary" onClick={() => setDialog({ kind: 'licence', brand })}>Licence</button><button className="btn btn-secondary" onClick={() => setDialog({ kind: 'payment', brand })}>Record renewal</button><button className="btn btn-primary" disabled={brand.maxBranches !== null && brand.branches.length >= brand.maxBranches} onClick={() => setDialog({ kind: 'branch', brand })}>Add branch</button></>}
          </div>
        </div>
        <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Branch</th><th>Code</th><th>Active students</th><th>Status</th>{platform && <th>Actions</th>}</tr></thead><tbody>{brand.branches.map((b: any) => <tr key={b.id}><td>{b.name}</td><td>{b.code}</td><td>{b.activeStudents} / {brand.maxStudents ?? 'Unlimited'}</td><td>{b.isActive ? 'Active' : 'Suspended'}</td>{platform && <td><button className="btn btn-secondary" disabled={change.isPending} onClick={() => change.mutate({ id: b.id, active: !b.isActive })}>{b.isActive ? 'Suspend' : 'Activate'}</button></td>}</tr>)}</tbody></table></div>
        {!platform && <div className="card overflow-x-auto"><h3 className="font-bold mb-2">Consolidated summary</h3><p className="text-sm text-gray-500 mb-3">Read only · financial totals cover all recorded dates in {brand.currency}. Choose a branch in the header to work on records.</p>{summary.isLoading ? <Spinner /> : summary.error ? <p>{apiError(summary.error)}</p> : <table className="table"><thead><tr><th>Branch</th><th>Students</th><th>Staff</th><th>Fee collections</th><th>Other income</th><th>Approved expenses</th></tr></thead><tbody>{summary.data?.branches.map((b: any) => <tr key={b.id}><td>{b.name}</td><td>{b.activeStudents}</td><td>{b.activeStaff}</td><td>{formatMoney(b.feeCollections)}</td><td>{formatMoney(b.otherIncome)}</td><td>{formatMoney(b.expenses)}</td></tr>)}</tbody></table>}</div>}
      </>}
    </>}
    {dialog && <BrandDialog kind={dialog.kind} brand={dialog.brand} onClose={() => setDialog(null)} />}
  </div>;
}

function BrandDialog({ kind, brand, onClose }: { kind: string; brand?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [f, set] = useState<Record<string, string>>({ name: brand?.name ?? '', code: '', logoUrl: brand?.logoUrl ?? '', branchName: '', branchCode: '', year: `${year}-${String(year + 1).slice(-2)}`, start: `${year}-04-01`, end: `${year + 1}-03-31`, ownerName: '', ownerEmail: '', password: '', plan: brand?.licencePlan ?? '', paidUntil: brand?.licencePaidUntil?.slice(0, 10) ?? '', maxBranches: brand?.maxBranches?.toString() ?? '', maxStudents: brand?.maxStudents?.toString() ?? '', graceDays: String(brand?.licenceGraceDays ?? 7), notifyDays: String(brand?.licenceNotifyDays ?? 10), amount: '', paidOn: new Date().toISOString().slice(0, 10), userId: '', schoolId: '', role: 'TEACHER', message: brand?.licenceMessage ?? '', override: String(brand?.licenceOverride ?? false), staffId: '', customRoleId: '' });
  const access = useQuery({ queryKey: ['brand-access', brand?.id], queryFn: () => brandsAPI.access(brand.id), enabled: kind === 'access' });
  const limit = (v: string) => v ? Number(v) : null;
  const branch = () => ({ name: f.branchName, code: f.branchCode, academicYear: { name: f.year, startDate: f.start, endDate: f.end } });
  const licence = () => ({ plan: f.plan || null, paidUntil: f.paidUntil || null, maxBranches: limit(f.maxBranches), maxStudents: limit(f.maxStudents), graceDays: Number(f.graceDays), notifyDays: Number(f.notifyDays), override: f.override === 'true', message: f.message || null });
  const done = () => { qc.invalidateQueries({ queryKey: ['brands'] }); qc.invalidateQueries({ queryKey: ['brand-summary'] }); qc.invalidateQueries({ queryKey: ['brand-access'] }); qc.invalidateQueries({ queryKey: ['session'] }); toast.success('Saved'); onClose(); };
  const m = useMutation({ mutationFn: async (): Promise<unknown> => {
    if (kind === 'create') return brandsAPI.create({ name: f.name, code: f.code, owner: { name: f.ownerName, email: f.ownerEmail, password: f.password }, licence: licence(), branch: branch() });
    if (kind === 'branch') return brandsAPI.createBranch(brand.id, branch());
    if (kind === 'licence') return brandsAPI.licence(brand.id, licence());
    if (kind === 'payment') return brandsAPI.payment(brand.id, { amount: Number(f.amount), paidOn: f.paidOn, paidUntil: f.paidUntil });
    if (kind === 'access') return brandsAPI.assign(brand.id, { userId: f.userId, schoolId: f.schoolId, role: f.role, ...(f.staffId ? { staffId: f.staffId } : {}), ...(f.customRoleId ? { customRoleId: f.customRoleId } : {}) });
    return brandsAPI.update(brand.id, { name: f.name, logoUrl: f.logoUrl || null });
  }, onSuccess: done, onError: e => toast.error(apiError(e)) });
  const undoPayment = useMutation({ mutationFn: (id: string) => brandsAPI.removePayment(brand.id, id), onSuccess: done, onError: e => toast.error(apiError(e)) });
  const drop = useMutation({ mutationFn: (id: string) => brandsAPI.removeAccess(brand.id, id), onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-access'] }), onError: e => toast.error(apiError(e)) });
  const input = (key: string, label: string, type = 'text', required = false) => <Field key={key} label={label}><input className="input" type={type} required={required} min={type === 'number' ? (key === 'graceDays' || key === 'notifyDays' ? 0 : 1) : undefined} value={f[key]} onChange={e => set({ ...f, [key]: e.target.value })} /></Field>;
  return <Modal open onClose={onClose} title={{ create: 'Create brand and first branch', branch: 'Add branch', licence: 'Brand licence', access: 'Staff branch access', branding: 'Brand settings', payment: 'Licence payment' }[kind] ?? kind} wide>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); m.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {['create', 'branding'].includes(kind) && <>{input('name', 'Brand name', 'text', true)}{kind === 'create' ? input('code', 'Brand code', 'text', true) : input('logoUrl', 'Shared logo URL (http/https)')}</>}
        {kind === 'create' && <>{input('ownerName', 'Owner name', 'text', true)}{input('ownerEmail', 'Owner email', 'email', true)}{input('password', 'Temporary password', 'password', true)}</>}
        {['create', 'branch'].includes(kind) && <>{input('branchName', 'Branch name', 'text', true)}{input('branchCode', 'Unique branch code', 'text', true)}{input('year', 'Academic year', 'text', true)}{input('start', 'Year starts', 'date', true)}{input('end', 'Year ends', 'date', true)}</>}
        {['create', 'licence'].includes(kind) && <>{input('plan', 'Plan')}{input('paidUntil', 'Paid until (empty = no expiry)', 'date')}{input('maxBranches', 'Maximum branches (empty = unlimited)', 'number')}{input('maxStudents', 'Active students per branch (empty = unlimited)', 'number')}{input('graceDays', 'Grace days', 'number')}{input('notifyDays', 'Notice days', 'number')}{input('message', 'Message to brand')}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.override === 'true'} onChange={e => set({ ...f, override: String(e.target.checked) })} />Keep active regardless of expiry</label></>}
        {kind === 'payment' && <>{input('amount', 'Amount', 'number', true)}{input('paidOn', 'Payment date', 'date', true)}{input('paidUntil', 'Extend licence until', 'date', true)}</>}
        {kind === 'access' && <>
          <Field label="Existing staff login"><select className="input" required value={f.userId} onChange={e => set({ ...f, userId: e.target.value, schoolId: '', staffId: '', customRoleId: '' })}><option value="">Choose user</option>{access.data?.users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></Field>
          <Field label="Additional branch"><select className="input" required value={f.schoolId} onChange={e => set({ ...f, schoolId: e.target.value, staffId: '', customRoleId: '' })}><option value="">Choose branch</option>{brand.branches.filter((b: any) => b.id !== access.data?.users.find((u: any) => u.id === f.userId)?.schoolId).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Role in this branch"><select className="input" value={f.role} onChange={e => set({ ...f, role: e.target.value, customRoleId: '' })}>{['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'].map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Custom role (optional)"><select className="input" value={f.customRoleId} onChange={e => set({ ...f, customRoleId: e.target.value })}><option value="">Standard role</option>{access.data?.customRoles.filter((r: any) => r.schoolId === f.schoolId && r.baseRole === f.role).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Branch HR profile (optional)"><select className="input" value={f.staffId} onChange={e => set({ ...f, staffId: e.target.value })}><option value="">No branch HR profile</option>{access.data?.staff.filter((r: any) => r.schoolId === f.schoolId).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <p className="text-sm text-gray-500 sm:col-span-2">Access changes sign the staff member out. Owners automatically access all their brand’s branches. Home-branch access is managed from Users & logins.</p>
        </>}
      </div>
      <button className="btn btn-primary" disabled={m.isPending}>Save</button>
    </form>
    {kind === 'licence' && <div className="mt-5 space-y-2"><h3 className="font-semibold">Brand renewal history</h3>{brand.payments.length === 0 && <p className="text-sm text-gray-500">No payments recorded.</p>}{brand.payments.map((p: any, i: number) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span>{formatDate(p.paidOn)} · {formatMoney(p.amount)} · until {formatDate(p.coversUntil)}</span>{i === 0 && <button className="btn btn-secondary" disabled={undoPayment.isPending} onClick={() => undoPayment.mutate(p.id)}>Undo latest payment</button>}</div>)}</div>}
    {kind === 'access' && <div className="mt-5 space-y-2">{access.data?.access.map((a: any) => <div key={a.id} className="flex items-center justify-between gap-2 text-sm border-t pt-2"><span>{access.data.users.find((u: any) => u.id === a.userId)?.name} · {brand.branches.find((b: any) => b.id === a.schoolId)?.name} · {a.role}</span><button className="btn btn-secondary" disabled={drop.isPending} onClick={() => drop.mutate(a.id)}>Revoke</button></div>)}</div>}
  </Modal>;
}
