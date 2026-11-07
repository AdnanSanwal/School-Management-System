import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Money from the API arrives as decimal strings ("4500.5"). */
export function formatMoney(amount: string | number | null | undefined, currency = 'PKR') {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: 0,
  }).format(n);
}

/** Kept for older components. */
export const formatCurrency = (amount: number, currency = 'PKR') => formatMoney(amount, currency);

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions) {
  // Date-only strings are UTC midnight; format in UTC so the day does not shift.
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...(options || { dateStyle: 'medium' }) }).format(new Date(date));
}

/** A moment (timestamp) shown as a date in the viewer's own time zone. */
export function formatLocalDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(date));
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

export function formatPeriod(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Today's date in the browser's local timezone as YYYY-MM-DD. */
export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export function sectionLabel(s?: { name: string; class?: { name: string } } | null) {
  if (!s) return '—';
  return s.class ? `${s.class.name}-${s.name}` : s.name;
}
