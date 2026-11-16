import { Prisma } from '@prisma/client';
import { basePrisma } from '../config/database';
import logger from './logger';

/**
 * Who may silence what, and when a push waits.
 *
 *   urgent   absence, fee due, low attendance. Always pushed at once, cannot be muted, and
 *            fall back to a text when the app cannot reach the person.
 *   direct   a message the office sent by hand (BROADCAST). The office chose the moment, so
 *            it is never muted or held back.
 *   routine  everything else. A person can mute a type; the school's quiet hours hold the
 *            push until morning.
 *
 * Muting and quiet hours only affect the push and the pop-up. The notification is always
 * saved and always shows in the app's list.
 */

export const URGENT_TYPES = ['ATTENDANCE_ABSENT', 'FEE_DUE', 'LOW_ATTENDANCE'];
const DIRECT_TYPES = ['BROADCAST'];

export const NOTIFICATION_LABELS: Record<string, string> = {
  ATTENDANCE_ABSENT: 'Absent from school',
  FEE_DUE: 'Fee due or overdue',
  LOW_ATTENDANCE: 'Low attendance',
  FEE_PAID: 'Fee payment received',
  DIARY_POSTED: 'Diary and homework',
  NOTICE_PUBLISHED: 'Notices and circulars',
  RESULT_PUBLISHED: 'Exam results',
  PAYMENT_CLAIM: 'Online payment claims',
  BROADCAST: 'Messages from the school office',
  LEAVE_REQUESTED: 'Leave requests',
  LEAVE_DECIDED: 'Leave decisions',
  EXPENSE_APPROVAL: 'Expenses waiting for approval',
  EXPENSE_DECIDED: 'Expense decisions',
  PAYROLL_APPROVAL: 'Payroll waiting for approval',
  PAYROLL_DECIDED: 'Payroll decisions',
  PAYSLIP_READY: 'Payslips',
};

/** What parents and students ever receive; staff see the whole list. */
const FAMILY_TYPES = ['ATTENDANCE_ABSENT', 'FEE_DUE', 'LOW_ATTENDANCE', 'FEE_PAID', 'DIARY_POSTED', 'NOTICE_PUBLISHED', 'RESULT_PUBLISHED', 'PAYMENT_CLAIM', 'BROADCAST'];

export const isRoutine = (type: string) => !URGENT_TYPES.includes(type) && !DIRECT_TYPES.includes(type);

/** The types to show on a person's settings screen. */
export function typesFor(role: string) {
  const all = Object.keys(NOTIFICATION_LABELS);
  return (role === 'PARENT' || role === 'STUDENT' ? all.filter((t) => FAMILY_TYPES.includes(t)) : all)
    .map((type) => ({ type, label: NOTIFICATION_LABELS[type], canMute: isRoutine(type), urgent: URGENT_TYPES.includes(type) }));
}

/** Cleans a stored or submitted mute list: known, mutable types only. */
export function mutedList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((t): t is string => typeof t === 'string' && t in NOTIFICATION_LABELS && isRoutine(t)))] : [];
}

// ─── Quiet hours ───

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClockTime = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * If `at` falls inside the school's quiet hours, the moment they end; otherwise null.
 * Times are the school's own clock ("21:00" to "07:00" crosses midnight).
 */
export function quietUntil(q: { quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string }, at = new Date()): Date | null {
  if (!isClockTime(q.quietHoursStart) || !isClockTime(q.quietHoursEnd)) return null;
  const start = minutes(q.quietHoursStart);
  const end = minutes(q.quietHoursEnd);
  if (start === end) return null;
  let now: number;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: q.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    now = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
  } catch {
    return null; // unknown timezone: don't hold anything back
  }
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return null;
  const wait = (end - now + 1440) % 1440;
  const until = new Date(at.getTime() + wait * 60_000);
  until.setSeconds(0, 0);
  return until;
}

// ─── Clean-up ───

/** Notifications older than this are deleted. NOTIFICATION_RETENTION_DAYS=0 keeps them forever. */
export function retentionDays() {
  const n = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 180);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 180;
}

/**
 * Deletes old notifications, a few thousand at a time so the table is never locked for
 * long. Returns how many were removed. Broadcasts themselves are kept (they are few), but
 * their per-person rows go, so an old broadcast's report shows only its saved totals.
 * `only.schoolId` limits it to one school.
 */
export async function cleanUpNotifications(now = new Date(), only?: { schoolId: string }): Promise<number> {
  const days = retentionDays();
  if (!days) return 0;
  const before = new Date(now.getTime() - days * 86_400_000);
  let removed = 0;
  for (let round = 0; round < 400; round++) {
    const n = await basePrisma.$executeRaw`DELETE FROM notifications WHERE createdAt < ${before} AND deliveryState <> 'PENDING'
      ${only ? Prisma.sql`AND schoolId = ${only.schoolId}` : Prisma.empty} LIMIT 5000`;
    removed += n;
    if (n < 5000) break;
  }
  if (removed) logger.info('Old notifications removed', { removed, olderThanDays: days });
  return removed;
}
