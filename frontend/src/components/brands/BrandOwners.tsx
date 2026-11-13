'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { brandsAPI, apiError } from '@/lib/api';
import { Field, Modal } from '@/components/ui/kit';

export function BrandOwners({ brand, onClose }: { brand: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [owners, setOwners] = useState<any[]>(brand.owners);
  const [form, setForm] = useState({ name: '', email: '', phone: '', schoolId: brand.branches[0]?.id ?? '' });
  const [credential, setCredential] = useState<{ name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['brands'] });
  const create = useMutation({ mutationFn: () => brandsAPI.createOwner(brand.id, { ...form, phone: form.phone || undefined }), onSuccess: r => {
    setOwners(previous => [...previous, r.owner]);
    setCredential({ name: r.owner.email || r.owner.name, password: r.temporaryPassword });
    setForm(previous => ({ ...previous, name: '', email: '', phone: '' }));
    refresh(); toast.success('Owner created');
  }, onError: e => toast.error(apiError(e)) });
  const reset = useMutation({ mutationFn: (owner: any) => brandsAPI.resetOwnerPassword(brand.id, owner.id), onSuccess: (r, owner) => {
    setCredential({ name: owner.email || owner.name, password: r.temporaryPassword });
    setConfirm(null); refresh(); toast.success('Owner password reset');
  }, onError: e => toast.error(apiError(e)) });
  const busy = create.isPending || reset.isPending;
  return <Modal open title={`Owners — ${brand.name}`} onClose={onClose} wide>
    <div className="space-y-5">
      <p className="text-sm text-gray-500">Owners can access every branch of this brand. New and reset passwords must be changed at the next login.</p>
      {credential && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
        <p className="font-semibold text-sm">Temporary login for {credential.name}</p>
        <code className="block select-all break-all rounded bg-white p-3 text-base">{credential.password}</code>
        <p className="text-xs text-amber-900">Share securely. This password disappears when you close this window.</p>
        <button className="btn btn-secondary" onClick={() => setCredential(null)}>Hide password</button>
      </div>}
      <div className="space-y-2">{owners.map(o => <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div><p className="font-semibold text-sm">{o.name}</p><p className="text-sm text-gray-500">{o.email}</p></div>
        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(o)}>Reset password</button>
      </div>)}</div>
      {confirm && <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
        <p className="text-sm">Reset the password for <strong>{confirm.name}</strong>? Their active sessions will end. Existing MFA stays enabled.</p>
        <div className="flex gap-2"><button className="btn btn-danger" disabled={busy} onClick={() => reset.mutate(confirm)}>Confirm reset</button><button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel reset</button></div>
      </div>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); setCredential(null); create.mutate(); }}>
        <h3 className="font-semibold">Create owner</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner name"><input className="input" required minLength={2} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Owner email"><input className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Phone (optional)"><input className="input" maxLength={32} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Home branch"><select className="input" required value={form.schoolId} onChange={e => setForm({ ...form, schoolId: e.target.value })}><option value="">Choose branch</option>{brand.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        </div>
        <button className="btn btn-primary" disabled={busy || !form.schoolId}>Create owner</button>
      </form>
    </div>
  </Modal>;
}
