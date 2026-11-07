import prisma from '../config/database';
import { currentSchoolId } from '../config/tenancy';

/**
 * Date-only values (attendance days, due dates) are stored as MySQL DATE and
 * handled in code as UTC-midnight Date objects built from 'YYYY-MM-DD'.
 * "Today" is the calendar day in the school's own timezone.
 */

export function toDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d;
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function dayInTimezone(timeZone: string, at = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Minutes the timezone is ahead of UTC at instant `at` (e.g. +300 for Asia/Karachi). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant at which calendar day `iso` begins in `timeZone`. For filtering timestamps by school day. */
export function zonedDayStart(iso: string, timeZone: string): Date {
  const midnightUtc = toDate(iso);
  const first = new Date(midnightUtc.getTime() - tzOffsetMinutes(timeZone, midnightUtc) * 60_000);
  // Re-check at the computed instant in case a DST change falls in between.
  return new Date(midnightUtc.getTime() - tzOffsetMinutes(timeZone, first) * 60_000);
}

const tzCache = new Map<string, { tz: string; at: number }>();

export async function schoolTimezone(): Promise<string> {
  const schoolId = currentSchoolId();
  const hit = tzCache.get(schoolId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.tz;
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  tzCache.set(schoolId, { tz: school.timezone, at: Date.now() });
  return school.timezone;
}

/** Today's date (UTC midnight) in the current school's timezone. */
export async function schoolToday(): Promise<Date> {
  return toDate(dayInTimezone(await schoolTimezone()));
}

/** First and last day of a 'YYYY-MM' period. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start, end };
}

export function periodOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}
