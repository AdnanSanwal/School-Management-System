// Matches the web app's palette (frontend/tailwind.config.js).
export const colors = {
  primary: '#4f46e5',
  primarySoft: '#eef2ff',
  text: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  border: '#e5e7eb',
  bg: '#f8fafc',
  card: '#ffffff',
  good: '#059669',
  goodSoft: '#ecfdf5',
  bad: '#dc2626',
  badSoft: '#fef2f2',
  warn: '#d97706',
  warnSoft: '#fffbeb',
  info: '#2563eb',
  infoSoft: '#eff6ff',
};

export const STATUS_COLORS: Record<string, { fg: string; bg: string; label: string }> = {
  PRESENT: { fg: colors.good, bg: colors.goodSoft, label: 'Present' },
  ABSENT: { fg: colors.bad, bg: colors.badSoft, label: 'Absent' },
  LATE: { fg: colors.warn, bg: colors.warnSoft, label: 'Late' },
  LEAVE: { fg: colors.info, bg: colors.infoSoft, label: 'Leave' },
  HALF_DAY: { fg: colors.warn, bg: colors.warnSoft, label: 'Half day' },
};
