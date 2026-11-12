'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Printer, Wallet } from 'lucide-react';
import { SearchInput, NoMatches, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner, StatusBadge, Empty } from '@/components/ui/kit';
import { studentsAPI, feesAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatDateTime, formatMoney, formatPeriod, sectionLabel } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function CollectFeePage() {
  return <Suspense><CollectFee /></Suspense>;
}

const METHODS = [
  ['CASH', 'Cash'], ['BANK_TRANSFER', 'Bank transfer'], ['JAZZCASH', 'JazzCash'], ['EASYPAISA', 'Easypaisa'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'],
] as const;

function CollectFee() {
  const params = useSearchParams();
  const router = useRouter();
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const [query, setQuery] = useState('');
  const [studentId, setStudentId] = useState(params.get('student') ?? '');
  // Opening /fees?student=… again (e.g. from the header search) switches to that student.
  const linkedStudent = params.get('student') ?? '';
  const [linked, setLinked] = useState(linkedStudent);
  if (linked !== linkedStudent) { setLinked(linkedStudent); if (linkedStudent) setStudentId(linkedStudent); }
  const qc = useQueryClient();

  const term = useDebounced(cleanTerm(query), 250);
  const search = useQuery({
    queryKey: ['fee-search', term],
    meta: { quiet: true },
    queryFn: () => studentsAPI.list({ search: term, limit: 8 }),
    enabled: term.length >= 2,
  });
  const settling = cleanTerm(query) !== term || search.isFetching;
  const ledger = useQuery({ queryKey: ['ledger', studentId], queryFn: () => feesAPI.ledger(studentId), enabled: !!studentId });

  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '', remarks: '' });
  const [selected, setSelected] = useState<string[]>([]);
  const open: any[] = (ledger.data?.invoices ?? []).filter((i: any) => i.status === 'UNPAID' || i.status === 'PARTIAL')
    .sort((a: any, b: any) => a.period.localeCompare(b.period));
  const due = (i: any) => Number(i.netAmount) + Number(i.fineAmount) - Number(i.paidAmount);
  const selectedDue = open.filter((i) => selected.includes(i.id)).reduce((s, i) => s + due(i), 0);

  // Default: all open months selected, amount = full balance.
  useEffect(() => {
    setSelected(open.map((i) => i.id));
    setPay((p) => ({ ...p, amount: ledger.data ? String(Number(ledger.data.pending)) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.data]);

  const collect = useMutation({
    mutationFn: () => feesAPI.collect({
      studentId, amount: Number(pay.amount), method: pay.method,
      reference: pay.reference || undefined, remarks: pay.remarks || undefined,
      invoiceIds: selected.length && selected.length < open.length ? selected : undefined,
    }),
    onSuccess: (r: any) => {
      toast.success(`Receipt ${r.payment.receiptNo}`);
      qc.invalidateQueries({ queryKey: ['ledger', studentId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      for (const key of ['invoices', 'defaulters', 'student', 'students', 'fee-search']) qc.invalidateQueries({ queryKey: [key] });
      router.push(`/fees/receipt/${r.payment.id}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const L = ledger.data;
  return (
    <DashboardLayout title="Collect fee" allowedRoles={CAN.collectFees} subtitle="Search a student, take payment, print the receipt">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3">
          <SearchInput autoFocus placeholder="Name, admission no. or parent phone" value={query} onChange={setQuery} aria-label="Find student" />
          {cleanTerm(query).length === 1 && <p className="text-xs text-gray-500">Type at least 2 characters…</p>}
          {settling && cleanTerm(query).length >= 2 && <Spinner label="Searching…" />}
          <ul className="divide-y divide-slate-100">
            {(search.data?.data ?? []).map((s: any) => (
              <li key={s.id}>
                <button className={`w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${s.id === studentId ? 'bg-primary-50' : ''}`}
                  onClick={() => { setStudentId(s.id); router.replace(`/fees?student=${s.id}`); }}>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.admissionNo} · {sectionLabel(s.section)}{s.primaryGuardian ? ` · ${s.primaryGuardian.phone}` : ''}</p>
                </button>
              </li>
            ))}
          </ul>
          {term.length >= 2 && !settling && search.data?.data.length === 0 && <NoMatches term={term} what="students" onClear={() => setQuery('')} />}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {!studentId && <div className="card"><Empty title="Find a student to begin" /></div>}
          {studentId && ledger.isLoading && <div className="card"><Spinner /></div>}
          {L && (
            <>
              <div className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/students/${L.student.id}`} className="text-lg font-semibold hover:text-primary-600">{L.student.name}</Link>
                  <p className="text-sm text-gray-500">{L.student.admissionNo} · {sectionLabel(L.student.section)}{L.paidTill ? ` · Paid till ${formatPeriod(L.paidTill)}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Pending</p>
                  <p className={`text-2xl font-bold ${Number(L.pending) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoney(L.pending, currency)}</p>
                </div>
              </div>

              {open.length > 0 ? (
                <form className="card space-y-4" onSubmit={(e) => { e.preventDefault(); collect.mutate(); }}>
                  <h3 className="section-title">Pending months</h3>
                  <ul className="divide-y divide-slate-100">
                    {open.map((i) => (
                      <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={selected.includes(i.id)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id);
                              setSelected(next);
                              setPay({ ...pay, amount: String(open.filter((o) => next.includes(o.id)).reduce((s, o) => s + due(o), 0)) });
                            }} />
                          <span className="font-medium">{formatPeriod(i.period)}</span>
                          <span className="text-gray-400">{i.invoiceNo} · due {formatDate(i.dueDate)}</span>
                          <StatusBadge status={i.status} />
                        </label>
                        <span className="font-medium">{formatMoney(due(i), currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Amount received" hint={`Selected months: ${formatMoney(selectedDue, currency)}`}>
                      <input type="number" min="1" step="0.01" max={selectedDue || undefined} required className="input text-lg font-semibold"
                        value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                    </Field>
                    <Field label="Method">
                      <select className="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                        {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label={pay.method === 'CASH' ? 'Reference (optional)' : 'Transaction ref *'}>
                      <input className="input" required={pay.method !== 'CASH'} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Remarks"><input className="input" value={pay.remarks} onChange={(e) => setPay({ ...pay, remarks: e.target.value })} /></Field>
                  <p className="text-xs text-gray-500">Partial amounts settle the oldest selected month first.</p>
                  <button className="btn btn-primary w-full" disabled={collect.isPending || !selected.length || !Number(pay.amount)}>
                    <Wallet className="h-4 w-4" /> {collect.isPending ? 'Saving…' : `Receive ${formatMoney(pay.amount || 0, currency)} and print receipt`}
                  </button>
                </form>
              ) : (
                <div className="card"><Empty title="No pending fee">Generate this month&apos;s invoices from the Invoices page if they are missing.</Empty></div>
              )}

              <div className="card">
                <h3 className="section-title mb-2">Recent payments</h3>
                {L.payments.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
                <ul className="divide-y divide-slate-100">
                  {L.payments.slice(0, 6).map((p: any) => (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{formatDateTime(p.paidAt)} · {p.method.replace('_', ' ').toLowerCase()} · {p.allocations.map((a: any) => formatPeriod(a.invoice.period)).join(', ')}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-medium">{formatMoney(p.amount, currency)}</span>
                        <Link href={`/fees/receipt/${p.id}`} className="btn-icon btn-ghost" aria-label={`Receipt ${p.receiptNo}`}><Printer className="h-4 w-4" /></Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
