'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import { Wallet, AlertCircle, Users, GraduationCap, TrendingUp, TrendingDown, Info, AlertTriangle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Stat, Spinner } from '@/components/ui/kit';
import { DetailsModal, type DetailKind } from '@/components/dashboard/DetailsModal';
import { dashboardAPI } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatMoney, formatPeriod, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export default function DashboardPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardAPI.overview, refetchInterval: 60_000 });

  return (
    <DashboardLayout title="Dashboard" allowedRoles={CAN.dashboard}
      subtitle={data ? `School overview · ${formatDate(data.date, { dateStyle: 'full' })}` : 'School overview'}>
      {isLoading && <Spinner />}
      {error && <div className="card text-sm text-red-600">Could not load the dashboard.</div>}
      {data && <Overview d={data} currency={currency} />}
    </DashboardLayout>
  );
}

function Overview({ d, currency }: { d: any; currency: string }) {
  const { fees, studentAttendance: sa, staffAttendance: ta } = d;
  const trendUp = fees && Number(fees.collectedToday) >= Number(fees.collectedYesterday);
  // CR-01: every card opens the live records behind its number.
  const [open, setOpen] = useState<DetailKind | null>(null);

  return (
    <>
      {open && <DetailsModal kind={open} currency={currency} onClose={() => setOpen(null)} />}
      {/* Row 1 — the spec's four cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {fees && (
          <Stat icon={Wallet} tone="good" label="Fee collected today" value={formatMoney(fees.collectedToday, currency)} onClick={() => setOpen('fees-today')}
            sub={<span className="inline-flex items-center gap-1">
              {trendUp ? <TrendingUp className="h-3 w-3 text-emerald-600" /> : <TrendingDown className="h-3 w-3 text-red-500" />}
              Yesterday {formatMoney(fees.collectedYesterday, currency)}
            </span>} />
        )}
        {fees && (
          <Stat icon={AlertCircle} tone="bad" label="Total remaining fee" value={formatMoney(fees.totalRemaining, currency)} onClick={() => setOpen('outstanding')}
            sub={`${fees.studentsOverdue30Days} overdue > 30 days`} />
        )}
        {ta && (
          <Stat icon={Users} tone={ta.percent !== null && ta.percent < 85 ? 'warn' : 'default'} label="Teachers present today" onClick={() => setOpen('staff-present')}
            value={ta.marked ? `${ta.teachersPresent}/${ta.teachersTotal}` : '—'}
            sub={ta.marked ? `${ta.percent}%` : 'Not marked yet'} />
        )}
        {sa && (
          <Stat icon={GraduationCap} tone={sa.percent !== null && sa.percent < 85 ? 'warn' : 'default'} label="Students present today" onClick={() => setOpen('students-present')}
            value={sa.marked ? `${sa.present.toLocaleString()}/${sa.totalActive.toLocaleString()}` : '—'}
            sub={sa.marked ? `${sa.percent}% · ${sa.sectionsMarked}/${sa.sectionsTotal} sections marked` : 'No section marked yet'} />
        )}
      </div>

      {/* Quick alerts */}
      {d.alerts.length > 0 && (
        <div role="button" tabIndex={0} onClick={() => setOpen('alerts')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen('alerts'))}
          className="card cursor-pointer space-y-2 transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" aria-label="Alerts: view all">
          <div className="flex items-center justify-between">
            <h3 className="section-title">Alerts</h3>
            <span className="text-xs font-medium text-primary-600">View all →</span>
          </div>
          <ul className="space-y-1.5">
            {d.alerts.map((a: any, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                {a.level === 'warning'
                  ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" aria-label="Warning" />
                  : <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-500" aria-label="Info" />}
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Row 2 — collection chart + finance overview */}
      {fees && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="card xl:col-span-2">
            <h3 className="section-title">Monthly fee collection</h3>
            <p className="mb-4 text-xs text-gray-500">Last 6 months</p>
            <CollectionChart months={fees.monthlyCollection} currency={currency} />
          </div>
          <div className="card space-y-3">
            <h3 className="section-title">Finance overview</h3>
            <Row label="This month" value={formatMoney(fees.collectedThisMonth, currency)} />
            <Row label="This academic year" value={formatMoney(fees.collectedThisYear, currency)} />
            <div className="divider" />
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Pending by class</p>
            {fees.pendingByClass.length === 0 && <p className="text-sm text-gray-500">Nothing pending.</p>}
            {fees.pendingByClass.map((c: any) => <Row key={c.classId} label={c.name} value={formatMoney(c.pending, currency)} />)}
          </div>
        </div>
      )}

      {/* Row 3 — staff + class strength */}
      <div className="grid gap-4 lg:grid-cols-2">
        {ta && (
          <div className="card">
            <h3 className="section-title mb-3">Staff today</h3>
            <Row label="On leave" value={ta.teachersOnLeave.length ? ta.teachersOnLeave.join(', ') : 'None'} />
            <Row label="Absent" value={ta.teachersAbsent.length ? ta.teachersAbsent.join(', ') : ta.marked ? 'None' : 'Not marked yet'} />
          </div>
        )}
        {d.classStrength && (
          <div className="card">
            <h3 className="section-title mb-3">Class-wise strength</h3>
            <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {d.classStrength.map((c: any) => <Row key={c.id} label={c.name} value={c.strength} />)}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

function CollectionChart({ months, currency }: { months: { month: string; amount: string }[]; currency: string }) {
  return (
    <div className="relative h-64">
      <Bar
        aria-label="Bar chart of fee collected per month for the last six months"
        data={{
          labels: months.map((m) => formatPeriod(m.month)),
          datasets: [{
            label: 'Collected',
            data: months.map((m) => Number(m.amount)),
            backgroundColor: '#6366f1',
            hoverBackgroundColor: '#4f46e5',
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: 'bottom',
            maxBarThickness: 36,
          }],
        }}
        options={{
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatMoney(ctx.parsed.y, currency) } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#64748b' } },
            y: {
              beginAtZero: true, border: { display: false },
              grid: { color: '#f1f5f9' },
              ticks: { color: '#94a3b8', callback: (v) => formatMoney(Number(v), currency) },
            },
          },
        }}
      />
      <table className="sr-only">
        <caption>Fee collected per month</caption>
        <tbody>{months.map((m) => <tr key={m.month}><th>{formatPeriod(m.month)}</th><td>{formatMoney(m.amount, currency)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
