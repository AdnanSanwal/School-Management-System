import type { LeaveBalance } from '@/lib/api';

export const LEAVE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', ANNUAL: 'Annual', UNPAID: 'Unpaid', OTHER: 'Other' };

/** A person's leave for the year: allowed, used (and how much of that is unpaid), left. */
export function LeaveCard({ year, balances, title = 'Leave' }: { year: string; balances: LeaveBalance[]; title?: string }) {
  const shown = balances.filter((b) => b.allowed > 0 || b.used > 0 || b.pending > 0);
  return (
    <div className="card">
      <h3 className="section-title mb-2">{title} <span className="text-xs font-normal text-gray-400">{year}</span></h3>
      {shown.length === 0 ? <p className="text-sm text-gray-500">No leave taken or allowed yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400"><th className="py-1 text-left font-normal">Type</th><th className="text-right font-normal">Allowed</th><th className="text-right font-normal">Used</th><th className="text-right font-normal">Left</th></tr></thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.type} className="border-t border-slate-50">
                <td className="py-1.5">{LEAVE_LABEL[b.type] ?? b.type}{b.pending > 0 && <span className="ml-1 text-xs text-amber-600">({b.pending} pending)</span>}</td>
                <td className="text-right">{b.isPaid ? b.allowed : '—'}</td>
                <td className="text-right">{b.used}{b.unpaid > 0 && <span className="ml-1 text-xs text-red-600">({b.unpaid} unpaid)</span>}</td>
                <td className="text-right font-medium">{b.isPaid ? b.remaining : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
