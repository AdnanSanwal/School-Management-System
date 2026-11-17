'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { KeyRound, Pencil, PlugZap, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner } from '@/components/ui/kit';
import { platformAiAPI, apiError } from '@/lib/api';

/** Platform admin: the platform's own AI keys, and what each school is provided and allowed. */
export default function PlatformAiPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['platform-ai'], queryFn: platformAiAPI.view });
  const [keyFor, setKeyFor] = useState<any | null>(null);
  const [school, setSchool] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const refresh = (fresh: any) => qc.setQueryData(['platform-ai'], fresh);

  const removeKey = useMutation({ mutationFn: (provider: string) => platformAiAPI.removeKey(provider), onSuccess: (fresh) => { toast.success('Key removed'); refresh(fresh); }, onError: (e) => toast.error(apiError(e)) });
  const testKey = useMutation({ mutationFn: (provider: string) => platformAiAPI.testKey(provider), onSuccess: (r) => toast.success(r.message, { duration: 6000 }), onError: (e) => toast.error(apiError(e), { duration: 9000 }) });

  if (isLoading || !data) return <DashboardLayout title="AI for schools" allowedRoles={['SUPER_ADMIN']}><Spinner /></DashboardLayout>;
  const label = (id?: string | null) => data.providers.find((p: any) => p.id === id)?.label ?? id ?? '';
  const rows = data.schools.filter((s: any) => !search.trim() || `${s.name} ${s.code}`.toLowerCase().includes(search.trim().toLowerCase()));
  const cap = (limit: number | null) => (limit == null ? 'no limit' : limit);

  return (
    <DashboardLayout title="AI for schools" allowedRoles={['SUPER_ADMIN']} subtitle="Your AI accounts, which schools may use them, and how much">
      <div className="space-y-4">
        <div className="card space-y-3">
          <div>
            <h3 className="section-title">Platform keys</h3>
            <p className="mt-1 text-sm text-gray-500">One key per provider, billed to you. A school you provide AI to uses the key of the provider you choose for it.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.keys.map((k: any) => (
              <div key={k.provider} className="rounded-xl border border-gray-100 p-3 text-sm">
                <p className="font-medium text-gray-900">{label(k.provider)}</p>
                <p className="mt-0.5 text-gray-500">{k.keyHint ? <>Key {k.keyHint}</> : 'No key saved'}</p>
                <p className="text-xs text-gray-400">Model: {k.model || data.providers.find((p: any) => p.id === k.provider)?.defaultModel}</p>
                <div className="mt-2 flex gap-1">
                  <button className="btn btn-secondary" onClick={() => setKeyFor(k)}><KeyRound className="h-4 w-4" /> {k.keyHint ? 'Change' : 'Add key'}</button>
                  {k.keyHint?.startsWith('•') && (
                    <>
                      <button className="btn-icon btn-ghost" aria-label={`Test the ${label(k.provider)} key`} title="Test" disabled={testKey.isPending} onClick={() => testKey.mutate(k.provider)}><PlugZap className="h-4 w-4" /></button>
                      <button className="btn-icon btn-ghost text-red-600" aria-label={`Remove the ${label(k.provider)} key`} title="Remove" onClick={() => { if (confirm(`Remove the ${label(k.provider)} key? Schools provided with it lose AI until a new key is saved.`)) removeKey.mutate(k.provider); }}><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <div>
              <h3 className="section-title">Schools</h3>
              <p className="mt-1 text-sm text-gray-500">Limits count drafts made on your keys. A school using its own key pays its provider itself and is not limited here.</p>
            </div>
            <input className="input w-56" type="search" placeholder="Find a school" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a school" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-gray-500">
                <tr><th className="px-4 py-3">School</th><th className="px-4 py-3">Provided by you</th><th className="px-4 py-3">Daily limit</th><th className="px-4 py-3">Monthly limit</th><th className="px-4 py-3">Used today</th><th className="px-4 py-3">Used this month</th><th className="px-4 py-3">Own key</th><th className="px-4 py-3"><span className="sr-only">Change</span></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((s: any) => {
                  const over = s.grant.monthlyLimit != null && s.usage.platform.month >= s.grant.monthlyLimit;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3"><span className="font-medium text-gray-900">{s.name}</span><span className="block text-xs text-gray-400">{s.code}{s.isActive ? '' : ' · suspended'}</span></td>
                      <td className="px-4 py-3">{s.grant.enabled ? <span className="text-emerald-700">{label(s.grant.provider)}{s.grant.keyHint ? ' · its own key' : ''}</span> : <span className="text-gray-400">Off</span>}</td>
                      <td className="px-4 py-3">{s.grant.enabled ? cap(s.grant.dailyLimit) : '—'}</td>
                      <td className="px-4 py-3">{s.grant.enabled ? cap(s.grant.monthlyLimit) : '—'}</td>
                      <td className="px-4 py-3">{s.usage.platform.today}</td>
                      <td className={`px-4 py-3 ${over ? 'font-medium text-red-600' : ''}`}>{s.usage.platform.month}{over ? ' · limit reached' : ''}</td>
                      <td className="px-4 py-3 text-gray-500">{!s.own.allowed ? 'Not allowed' : s.own.provider ? `${label(s.own.provider)} · ${s.usage.own.month} this month` : 'None'}</td>
                      <td className="px-4 py-3 text-right"><button className="btn btn-secondary" onClick={() => setSchool(s)}><Pencil className="h-4 w-4" /> Change</button></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">No school matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {keyFor && <KeyModal entry={keyFor} providers={data.providers} onClose={() => setKeyFor(null)} onSaved={(fresh) => { refresh(fresh); setKeyFor(null); }} />}
      {school && <SchoolModal school={school} providers={data.providers} keys={data.keys} onClose={() => setSchool(null)} onSaved={(fresh) => { refresh(fresh); setSchool(null); }} />}
    </DashboardLayout>
  );
}

function KeyModal({ entry, providers, onClose, onSaved }: { entry: any; providers: any[]; onClose: () => void; onSaved: (fresh: any) => void }) {
  const p = providers.find((x) => x.id === entry.provider);
  const saved = !!entry.keyHint?.startsWith('•');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(entry.model ?? '');
  const save = useMutation({
    mutationFn: () => platformAiAPI.saveKey(entry.provider, { model: model.trim() || null, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
    onSuccess: (fresh) => { toast.success('Key saved'); onSaved(fresh); }, onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`${p?.label} key`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="API key" hint={saved ? `A key ending ${entry.keyHint.slice(-4)} is saved. Leave empty to keep it.` : 'Stored encrypted. It is never shown again after saving.'}>
          <input className="input font-mono" type="password" autoComplete="off" maxLength={400} required={!saved} placeholder={saved ? entry.keyHint : 'Paste the key here'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        <Field label="Model" hint={`Leave empty to use ${p?.defaultModel}.`}><input className="input" maxLength={80} placeholder={p?.defaultModel} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SchoolModal({ school, providers, keys, onClose, onSaved }: { school: any; providers: any[]; keys: any[]; onClose: () => void; onSaved: (fresh: any) => void }) {
  const g = school.grant;
  const [enabled, setEnabled] = useState<boolean>(g.enabled);
  const [provider, setProvider] = useState<string>(g.provider ?? providers[0]?.id ?? '');
  const [model, setModel] = useState<string>(g.model ?? '');
  const [daily, setDaily] = useState<string>(g.dailyLimit ?? '');
  const [monthly, setMonthly] = useState<string>(g.monthlyLimit ?? '');
  const [ownAllowed, setOwnAllowed] = useState<boolean>(school.own.allowed);
  const [apiKey, setApiKey] = useState('');
  const [dropKey, setDropKey] = useState(false);
  const p = providers.find((x) => x.id === provider);
  const platformHasKey = !!keys.find((k) => k.provider === provider)?.keyHint;
  const hasOwnKeyForSchool = !!g.keyHint && !dropKey && g.provider === provider;
  const number = (v: string) => (String(v).trim() === '' ? null : Number(v));

  const save = useMutation({
    mutationFn: () => platformAiAPI.saveSchool(school.id, {
      enabled, provider: enabled ? provider : g.provider ?? null, model: model.trim() || null,
      dailyLimit: number(daily), monthlyLimit: number(monthly), ownAllowed,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : dropKey || (g.keyHint && g.provider !== provider) ? { apiKey: '' } : {}),
    }),
    onSuccess: (fresh) => { toast.success(`Saved for ${school.name}`); onSaved(fresh); }, onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} title={`AI for ${school.name}`} wide>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span><span className="font-medium text-gray-900">Provide AI to this school</span><span className="block text-gray-500">The school uses your account, within the limits below.</span></span>
          </label>
          {enabled && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Provider">
                  <select className="select" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
                    {providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </Field>
                <Field label="Model" hint={`Leave empty to use ${keys.find((k) => k.provider === provider)?.model || p?.defaultModel}.`}><input className="input" maxLength={80} placeholder={p?.defaultModel} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></Field>
              </div>
              {!platformHasKey && !hasOwnKeyForSchool && !apiKey.trim() && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">You have no platform key for {p?.label} yet. Add one under “Platform keys”, or enter a key just for this school below. Until then AI stays off for the school.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Daily limit (drafts)" hint="Empty = no daily limit. 0 = none allowed."><input className="input" type="number" min={0} max={100000} placeholder="No limit" value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
                <Field label="Monthly limit (drafts)" hint="Empty = no monthly limit. Starts again on the 1st."><input className="input" type="number" min={0} max={100000} placeholder="No limit" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
              </div>
              <p className="text-xs text-gray-500">Used on your account: {school.usage.platform.today} today, {school.usage.platform.month} this month. One draft is one AI-written paper.</p>
              <details className="rounded-xl border border-gray-100 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-gray-700">A separate key just for this school (optional)</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-gray-500">Use this to bill one school&apos;s use to its own key at the provider. Otherwise the platform key is used.</p>
                  <input className="input font-mono" type="password" autoComplete="off" maxLength={400} placeholder={hasOwnKeyForSchool ? g.keyHint : 'Paste a key, or leave empty'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label="A key just for this school" />
                  {g.keyHint && g.provider === provider && <label className="flex items-center gap-2 text-gray-600"><input type="checkbox" checked={dropKey} onChange={(e) => setDropKey(e.target.checked)} /> Remove the saved key ({g.keyHint}) and use the platform key</label>}
                </div>
              </details>
            </>
          )}
        </div>

        <label className="flex items-start gap-2 border-t border-gray-100 pt-4 text-sm">
          <input type="checkbox" className="mt-1" checked={ownAllowed} onChange={(e) => setOwnAllowed(e.target.checked)} />
          <span><span className="font-medium text-gray-900">Let this school use its own AI key</span><span className="block text-gray-500">The school can connect its own account in its settings and pays its provider itself. Your limits do not apply to that use.{school.own.provider ? ' It has a key saved now.' : ''}</span></span>
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
