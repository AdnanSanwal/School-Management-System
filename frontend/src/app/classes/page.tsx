'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty } from '@/components/ui/kit';
import { academicsAPI, staffAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';

export default function ClassesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageClasses');
  const qc = useQueryClient();
  const { data: classes = [], isLoading } = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => staffAPI.list({ teachers: 'true', limit: 200 }), enabled: manage });
  const [modal, setModal] = useState<null | 'class' | 'subject' | { section: any; classId: string } | { addSectionTo: any }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['classes'] });

  const setTeacher = useMutation({
    mutationFn: ({ id, classTeacherId }: { id: string; classTeacherId: string | null }) => academicsAPI.updateSection(id, { classTeacherId }),
    onSuccess: () => { toast.success('Class teacher updated'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const delSection = useMutation({
    mutationFn: (id: string) => academicsAPI.deleteSection(id),
    onSuccess: () => { toast.success('Section deleted'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const teacherList: any[] = teachers.data?.data ?? [];

  return (
    <DashboardLayout title="Classes & sections" allowedRoles={CAN.viewClasses}
      subtitle={`${classes.length} classes · ${classes.reduce((n: number, c: any) => n + c.strength, 0)} students`}
      actions={manage && <>
        <button className="btn btn-secondary" onClick={() => setModal('subject')}><BookOpen className="h-4 w-4" /> Subjects</button>
        <button className="btn btn-primary" onClick={() => setModal('class')}><Plus className="h-4 w-4" /> Add class</button>
      </>}>
      {isLoading ? <Spinner /> : classes.length === 0 ? <div className="card"><Empty title="No classes yet" /></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((c: any) => (
            <div key={c.id} className="card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{c.name}</h3>
                <span className="text-sm text-gray-500">{c.strength} students</span>
              </div>
              <ul className="space-y-2">
                {c.sections.map((s: any) => (
                  <li key={s.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Section {s.name}</span>
                      <span className="text-gray-500">{s.strength}{s.capacity ? `/${s.capacity}` : ''}</span>
                    </div>
                    {manage ? (
                      <div className="mt-2 flex items-center gap-2">
                        <select className="select h-8 flex-1 py-0 text-xs" value={s.classTeacher?.id ?? ''} aria-label={`Class teacher of ${c.name}-${s.name}`}
                          onChange={(e) => setTeacher.mutate({ id: s.id, classTeacherId: e.target.value || null })}>
                          <option value="">No class teacher</option>
                          {teacherList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => setModal({ section: s, classId: c.id })}>Subjects</button>
                        {s.strength === 0 && (
                          <button className="btn-icon btn-ghost h-8 w-8 text-red-500" aria-label="Delete section"
                            onClick={() => confirm(`Delete section ${c.name}-${s.name}?`) && delSection.mutate(s.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ) : <p className="mt-1 text-gray-500">Class teacher: {s.classTeacher?.name ?? '—'}</p>}
                  </li>
                ))}
              </ul>
              {manage && <button className="btn btn-ghost mt-2 w-full text-sm" onClick={() => setModal({ addSectionTo: c })}><Plus className="h-4 w-4" /> Add section</button>}
            </div>
          ))}
        </div>
      )}
      {modal === 'class' && <ClassModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'subject' && <SubjectsModal onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && 'addSectionTo' in modal && <SectionModal cls={modal.addSectionTo} onClose={() => setModal(null)} onDone={refresh} />}
      {modal && typeof modal === 'object' && 'section' in modal && <SectionSubjectsModal section={modal.section} teachers={teacherList} onClose={() => setModal(null)} />}
    </DashboardLayout>
  );
}

function ClassModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', level: '', sections: 'A' });
  const m = useMutation({
    mutationFn: () => academicsAPI.createClass({ name: f.name, level: Number(f.level), sections: f.sections.split(',').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success('Class created'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add class">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Class 9" /></Field>
        <Field label="Level" hint="Used for ordering and promotion: Nursery 0, Class 1 = 1 …"><input type="number" className="input" required value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
        <Field label="Sections" hint="Comma separated"><input className="input" value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} /></Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Create</button>
      </form>
    </Modal>
  );
}

function SectionModal({ cls, onClose, onDone }: { cls: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', capacity: '' });
  const m = useMutation({
    mutationFn: () => academicsAPI.addSection(cls.id, { name: f.name, capacity: f.capacity ? Number(f.capacity) : undefined }),
    onSuccess: () => { toast.success('Section added'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Add section to ${cls.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Section name"><input className="input" required maxLength={10} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="C" /></Field>
        <Field label="Capacity"><input type="number" min="1" className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Add</button>
      </form>
    </Modal>
  );
}

function SubjectsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['subjects'], queryFn: academicsAPI.subjects });
  const [f, setF] = useState({ name: '', code: '' });
  const m = useMutation({
    mutationFn: () => academicsAPI.createSubject(f),
    onSuccess: () => { toast.success('Subject added'); setF({ name: '', code: '' }); qc.invalidateQueries({ queryKey: ['subjects'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Subjects">
      <ul className="mb-4 flex flex-wrap gap-2">{data.map((s: any) => <li key={s.id} className="badge badge-indigo">{s.name} · {s.code}</li>)}</ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <input className="input flex-1" required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Subject name" />
        <input className="input w-28" required placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Subject code" />
        <button className="btn btn-primary" disabled={m.isPending}>Add</button>
      </form>
    </Modal>
  );
}

function SectionSubjectsModal({ section, teachers, onClose }: { section: any; teachers: any[]; onClose: () => void }) {
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: academicsAPI.subjects });
  const current = useQuery({ queryKey: ['section-subjects', section.id], queryFn: () => academicsAPI.sectionSubjects(section.id) });
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => { if (current.data) setMap(Object.fromEntries(current.data.map((a: any) => [a.subjectId, a.teacherId]))); }, [current.data]);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => academicsAPI.setSectionSubjects(section.id, Object.entries(map).filter(([, t]) => t).map(([subjectId, teacherId]) => ({ subjectId, teacherId }))),
    onSuccess: () => { toast.success('Subject teachers saved'); qc.invalidateQueries({ queryKey: ['section-subjects', section.id] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Subject teachers — section ${section.name}`}>
      {subjects.isLoading || current.isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {(subjects.data ?? []).map((s: any) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="w-32">{s.name}</span>
              <select className="select flex-1" value={map[s.id] ?? ''} onChange={(e) => setMap({ ...map, [s.id]: e.target.value })} aria-label={`Teacher for ${s.name}`}>
                <option value="">Not taught</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ))}
          <button className="btn btn-primary mt-2 w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save</button>
        </div>
      )}
    </Modal>
  );
}
