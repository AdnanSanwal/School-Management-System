/**
 * Turns per-status counts into a summary with an attendance %.
 * Late counts as attended; half-day counts as half; leave/absent do not.
 */
export type AttendanceCounts = Partial<Record<'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' | 'HALF_DAY', number>>;

export function attendanceSummary(rows: { status: string; _count: number }[]): AttendanceCounts & { total: number; percent: number | null } {
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count])) as AttendanceCounts;
  const total = rows.reduce((n, r) => n + r._count, 0);
  const attended = (by.PRESENT ?? 0) + (by.LATE ?? 0) + (by.HALF_DAY ?? 0) * 0.5;
  return { total, ...by, percent: total ? Math.round((attended / total) * 1000) / 10 : null };
}

/** Counts statuses in a list of records, shaped like a Prisma groupBy result. */
export function countStatuses(records: { status: string }[], weight: (r: any) => number = () => 1) {
  const m = new Map<string, number>();
  for (const r of records) m.set(r.status, (m.get(r.status) ?? 0) + weight(r));
  return [...m].map(([status, _count]) => ({ status, _count }));
}
