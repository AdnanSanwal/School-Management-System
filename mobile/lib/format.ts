export function money(amount: string | number | null | undefined, currency = 'PKR') {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
}

/** Date-only strings ("2026-11-07") are formatted in UTC so the day never shifts. */
export function day(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

export function period(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return day(iso);
}

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function sectionName(s?: { name: string; class?: { name: string } } | null) {
  return s ? (s.class ? `${s.class.name}-${s.name}` : s.name) : '';
}
