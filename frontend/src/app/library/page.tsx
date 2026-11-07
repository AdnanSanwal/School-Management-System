'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Pencil, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, StudentPicker } from '@/components/ui/kit';
import { libraryAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const LOAN_TABS = [
  { key: 'open', label: 'Issued' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'unpaid-fines', label: 'Unpaid fines' },
  { key: 'returned', label: 'Returned' },
] as const;

export default function LibraryPage() {
  const user = useAuthStore((s) => s.user);
  const manage = can(user?.role, 'manageLibrary');
  const [tab, setTab] = useState<'loans' | 'books'>('loans');
  const [issuing, setIssuing] = useState(false);

  return (
    <DashboardLayout title="Library" allowedRoles={CAN.viewLibrary} subtitle="Books, loans and late fines"
      actions={manage && <button className="btn btn-primary" onClick={() => setIssuing(true)}><BookOpen className="h-4 w-4" /> Issue book</button>}>
      <div className="flex gap-2" role="tablist">
        {(['loans', 'books'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={cn('btn', tab === t ? 'btn-secondary' : 'btn-ghost')} onClick={() => setTab(t)}>
            {t === 'loans' ? 'Loans' : 'Books'}
          </button>
        ))}
      </div>
      {tab === 'loans' ? <Loans manage={manage} currency={user?.school?.currency ?? 'PKR'} /> : <Books manage={manage} />}
      {issuing && <IssueModal onClose={() => setIssuing(false)} />}
    </DashboardLayout>
  );
}

function Loans({ manage, currency }: { manage: boolean; currency: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('open');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({ queryKey: ['library', 'issues', status, page], queryFn: () => libraryAPI.issues({ status, page, limit: 25 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['library'] });
  const ret = useMutation({
    mutationFn: libraryAPI.returnBook,
    onSuccess: (r: any) => { toast.success(Number(r.fine) > 0 ? `Returned ${r.daysLate} day(s) late — fine ${formatMoney(r.fine, currency)}` : 'Returned'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const fine = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'paid' | 'waive' }) => libraryAPI.fine(id, action),
    onSuccess: (_r, v) => { toast.success(v.action === 'paid' ? 'Fine marked as paid' : 'Fine waived'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];
  const pages = data?.pagination?.totalPages ?? 1;

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap gap-1">
        {LOAN_TABS.map((t) => (
          <button key={t.key} className={cn('rounded-full px-3 py-1 text-sm', status === t.key ? 'bg-primary-600 text-white' : 'bg-slate-100 text-gray-600 hover:bg-slate-200')}
            onClick={() => { setStatus(t.key); setPage(1); }}>{t.label}</button>
        ))}
      </div>
      {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : !rows.length ? <Empty title="Nothing here" /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Book</th><th>Student</th><th>Issued</th><th>Due</th><th>Fine</th><th /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td><p className="font-medium">{l.book.title}</p>{l.book.author && <p className="text-xs text-gray-500">{l.book.author}</p>}</td>
                  <td><p className="text-sm">{l.student.name}</p><p className="text-xs text-gray-500">{l.student.admissionNo}{l.student.section ? ` · ${l.student.section.class.name}-${l.student.section.name}` : ''}</p></td>
                  <td className="text-sm">{formatDate(l.issuedAt)}</td>
                  <td className="text-sm">
                    <span className={l.overdue ? 'font-medium text-red-600' : ''}>{formatDate(l.dueDate)}</span>
                    {l.overdue && <span className="block text-xs text-red-500">{l.daysLate} day(s) late</span>}
                    {l.returnedAt && <span className="block text-xs text-gray-500">returned {formatDate(l.returnedAt)}</span>}
                  </td>
                  <td className="text-sm">
                    {l.returnedAt
                      ? Number(l.fine) > 0 ? <>{formatMoney(l.fine, currency)} {l.finePaid ? <span className="badge badge-green">paid</span> : <span className="badge badge-red">unpaid</span>}</> : '—'
                      : Number(l.fineSoFar) > 0 ? <span className="text-red-600">{formatMoney(l.fineSoFar, currency)} so far</span> : '—'}
                  </td>
                  <td className="whitespace-nowrap">
                    {manage && !l.returnedAt && <button className="btn btn-secondary px-2 py-1 text-xs" disabled={ret.isPending} onClick={() => ret.mutate(l.id)}>Return</button>}
                    {manage && l.returnedAt && !l.finePaid && Number(l.fine) > 0 && (
                      <span className="flex gap-1">
                        <button className="btn btn-secondary px-2 py-1 text-xs" onClick={() => fine.mutate({ id: l.id, action: 'paid' })}>Paid</button>
                        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm('Waive this fine?') && fine.mutate({ id: l.id, action: 'waive' })}>Waive</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="self-center text-gray-500">Page {page} of {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function Books({ manage }: { manage: boolean }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['library', 'books', search, page], meta: { quiet: !!search }, queryFn: () => libraryAPI.books({ search: search || undefined, page, limit: 25 }) });
  const rows: any[] = data?.data ?? [];
  const pages = data?.pagination?.totalPages ?? 1;
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input className="input pl-9" placeholder="Title, author, ISBN, category" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search books" />
        </div>
        {manage && <button className="btn btn-secondary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> Add book</button>}
      </div>
      {isLoading ? <Spinner /> : !rows.length ? <Empty title={search ? 'No book matches' : 'No books yet'} /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Title</th><th>Category</th><th>Shelf</th><th>Copies</th><th>Available</th><th /></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><p className="font-medium">{b.title}</p><p className="text-xs text-gray-500">{[b.author, b.isbn].filter(Boolean).join(' · ')}</p></td>
                  <td className="text-sm">{b.category ?? '—'}</td>
                  <td className="text-sm">{b.shelf ?? '—'}</td>
                  <td>{b.copies}</td>
                  <td><span className={b.available > 0 ? 'text-emerald-600' : 'text-red-600'}>{b.available}</span></td>
                  <td>{manage && <button className="btn-icon btn-ghost h-7 w-7" aria-label={`Edit ${b.title}`} onClick={() => setEdit(b)}><Pencil className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="self-center text-gray-500">Page {page} of {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {edit && <BookModal book={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BookModal({ book, onClose }: { book: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !book.id;
  const [f, setF] = useState({
    title: book.title ?? '', author: book.author ?? '', isbn: book.isbn ?? '', category: book.category ?? '', shelf: book.shelf ?? '', copies: String(book.copies ?? 1),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body = { title: f.title, author: f.author || null, isbn: f.isbn || null, category: f.category || null, shelf: f.shelf || null, copies: Number(f.copies) };
      return isNew ? libraryAPI.addBook(body) : libraryAPI.updateBook(book.id, body);
    },
    onSuccess: () => { toast.success(isNew ? 'Book added' : 'Book updated'); qc.invalidateQueries({ queryKey: ['library'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add book' : 'Edit book'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title"><input className="input" required value={f.title} onChange={set('title')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Author"><input className="input" value={f.author} onChange={set('author')} /></Field>
          <Field label="ISBN"><input className="input" value={f.isbn} onChange={set('isbn')} /></Field>
          <Field label="Category"><input className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="Shelf"><input className="input" value={f.shelf} onChange={set('shelf')} /></Field>
        </div>
        <Field label="Copies"><input type="number" min="1" max="1000" className="input" required value={f.copies} onChange={set('copies')} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function IssueModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [student, setStudent] = useState<any>(null);
  const [q, setQ] = useState('');
  const [book, setBook] = useState<any>(null);
  const [dueDate, setDueDate] = useState('');
  const books = useQuery({ queryKey: ['library', 'books', 'pick', q], meta: { quiet: true }, queryFn: () => libraryAPI.books({ search: q, available: 'true', limit: 8 }), enabled: q.trim().length >= 2 && !book });
  const m = useMutation({
    mutationFn: () => libraryAPI.issue({ bookId: book.id, studentId: student.id, dueDate: dueDate || undefined }),
    onSuccess: (r: any) => { toast.success(`Issued — due ${formatDate(r.dueDate)}`); qc.invalidateQueries({ queryKey: ['library'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Issue a book">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (book && student) m.mutate(); }}>
        <Field label="Student"><StudentPicker value={student} onChange={setStudent} /></Field>
        <Field label="Book">
          {book ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span><b>{book.title}</b> <span className="text-gray-500">· {book.available} available</span></span>
              <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => { setBook(null); setQ(''); }}>Change</button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" placeholder="Search available books" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search book" />
              {q.trim().length >= 2 && (
                <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {!books.isFetching && !(books.data?.data ?? []).length && <li className="px-3 py-2 text-sm text-gray-400">No available copy</li>}
                  {(books.data?.data ?? []).map((b: any) => (
                    <li key={b.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setBook(b)}>
                      <b>{b.title}</b> <span className="text-gray-500">{b.author ? `· ${b.author} ` : ''}· {b.available} available</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
        <Field label="Due date" hint="Leave blank for 14 days"><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!book || !student || m.isPending}>Issue</button>
        </div>
      </form>
    </Modal>
  );
}
