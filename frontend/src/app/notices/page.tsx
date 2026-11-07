'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Paperclip, Trash2, Send, Eye } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, useSections } from '@/components/ui/kit';
import { noticesAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const AUDIENCE: Record<string, string> = {
  ALL: 'Everyone', STAFF: 'Staff', PARENTS: 'Parents', STUDENTS: 'Students', SECTIONS: 'Selected classes',
};

export default function NoticesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const publisher = can(role, 'publishNotices');
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['notices'], queryFn: () => noticesAPI.list({ limit: 50 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notices'] });

  const read = useMutation({ mutationFn: noticesAPI.read, onSuccess: refresh });
  const publish = useMutation({
    mutationFn: noticesAPI.publish,
    onSuccess: (r: any) => { toast.success(`Published to ${r.notified} people`); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: noticesAPI.remove,
    onSuccess: () => { toast.success('Notice deleted'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const rows: any[] = data?.data ?? [];
  const toggle = (n: any) => {
    setOpen(open === n.id ? null : n.id);
    if (n.publishedAt && !n.readAt) read.mutate(n.id);
  };

  return (
    <DashboardLayout title="Notices & circulars" allowedRoles={CAN.viewNotices}
      subtitle={data ? `${data.unread} unread` : undefined}
      actions={publisher && <button className="btn btn-primary" onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> New notice</button>}>
      <div className="space-y-3">
        {isLoading ? <Spinner /> : rows.length === 0 ? <div className="card"><Empty title="No notices yet" /></div> : rows.map((n) => (
          <div key={n.id} className={cn('card', n.publishedAt && !n.readAt && 'border-primary-200 bg-primary-50/30')}>
            <button className="w-full text-left" onClick={() => toggle(n)} aria-expanded={open === n.id}>
              <div className="flex flex-wrap items-center gap-2">
                {n.publishedAt && !n.readAt && <span className="h-2 w-2 rounded-full bg-primary-500" aria-label="Unread" />}
                <h3 className={cn('flex-1 text-gray-900', !n.readAt ? 'font-semibold' : 'font-medium')}>{n.title}</h3>
                {!n.publishedAt && <span className="badge badge-yellow">draft</span>}
                <span className="badge badge-indigo">{AUDIENCE[n.audience]}{n.sections.length ? `: ${n.sections.join(', ')}` : ''}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{n.author ?? 'School'} · {n.publishedAt ? formatDateTime(n.publishedAt) : 'not published'}
                {publisher && n._count && <> · <Eye className="inline h-3 w-3" /> read by {n._count.reads}</>}</p>
              <p className={cn('mt-2 whitespace-pre-line text-sm text-gray-700', open !== n.id && 'line-clamp-2')}>{n.body}</p>
            </button>
            {(open === n.id || !n.publishedAt) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {n.attachment && <a className="btn btn-ghost px-2 py-1 text-sm" href={n.attachment} target="_blank" rel="noreferrer noopener"><Paperclip className="h-4 w-4" /> Attachment</a>}
                {publisher && !n.publishedAt && <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={publish.isPending} onClick={() => publish.mutate(n.id)}><Send className="h-4 w-4" /> Publish</button>}
                {publisher && <button className="btn btn-ghost px-2 py-1 text-sm text-red-600" onClick={() => confirm(`Delete “${n.title}”?`) && remove.mutate(n.id)}><Trash2 className="h-4 w-4" /> Delete</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      {composing && <Compose onClose={() => setComposing(false)} onDone={refresh} />}
    </DashboardLayout>
  );
}

function Compose({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: sections = [] } = useSections();
  const [f, setF] = useState({ title: '', body: '', audience: 'ALL', sectionIds: [] as string[] });
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: (publish: boolean) => {
      const form = new FormData();
      form.append('title', f.title);
      form.append('body', f.body);
      form.append('audience', f.audience);
      form.append('sectionIds', f.sectionIds.join(','));
      form.append('publish', String(publish));
      if (file) form.append('file', file);
      return noticesAPI.create(form);
    },
    onSuccess: (r: any, publish) => { toast.success(publish ? `Published to ${r.notified} people` : 'Draft saved'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New notice" wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(true); }}>
        <Field label="Title"><input className="input" required minLength={2} maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message"><textarea className="input" rows={6} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Send to">
          <select className="select" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
            {Object.entries(AUDIENCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {f.audience === 'SECTIONS' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Classes">
            {sections.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-sm">
                <input type="checkbox" checked={f.sectionIds.includes(s.id)}
                  onChange={(e) => setF({ ...f, sectionIds: e.target.checked ? [...f.sectionIds, s.id] : f.sectionIds.filter((x) => x !== s.id) })} />
                {s.label}
              </label>
            ))}
          </div>
        )}
        <Field label="Attachment (optional)" hint="PDF or image, up to 5 MB">
          <input type="file" className="input" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <p className="text-xs text-gray-500">Publishing sends a push notification to everyone in the audience.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={m.isPending || !f.title || !f.body} onClick={() => m.mutate(false)}>Save draft</button>
          <button className="btn btn-primary" disabled={m.isPending}><Send className="h-4 w-4" /> Publish</button>
        </div>
      </form>
    </Modal>
  );
}
