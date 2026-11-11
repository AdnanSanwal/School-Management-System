import { basePrisma } from '../config/database';
import { dayInTimezone } from './dates';

// Subscription licence, per school. Same states as our other products:
//   ACTIVE    paid up (or no end date set, or kept on by the platform)
//   DUE_SOON  paid up, but the end date is within the notice period
//   GRACE     past the end date, still working for the grace days
//   LOCKED    past the grace days: the school can sign in and see why, nothing else works
// A suspended school (School.isActive = false) can't sign in at all; that is separate.
// The platform admin sets the dates; every server reads them at most once per school
// every few seconds.

export type LicenceState = 'ACTIVE' | 'DUE_SOON' | 'GRACE' | 'LOCKED';

export interface LicenceFields {
  licencePlan: string | null; licencePaidUntil: Date | null; licenceGraceDays: number; licenceNotifyDays: number;
  licenceOverride: boolean; licenceMessage: string | null; maxStudents: number | null;
}
export interface LicenceStatus {
  state: LicenceState; plan: string | null;
  /** Last day paid for (YYYY-MM-DD); null = no end date. */
  paidUntil: string | null;
  /** Days until `paidUntil` (negative once it has passed). */
  daysLeft: number | null;
  /** First day the school is locked. */
  lockDate: string | null;
  graceDays: number; notifyDays: number; maxStudents: number | null;
  /** A note from the platform shown to the school. */
  message: string | null;
  /** Plain words for the state. */
  summary: string;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const nice = (d: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** Works out the state for `today` (YYYY-MM-DD in the school's timezone). Pure. */
export function evaluateLicence(f: Partial<LicenceFields> | null | undefined, today: string): LicenceStatus {
  const graceDays = f?.licenceGraceDays ?? 7;
  const notifyDays = f?.licenceNotifyDays ?? 10;
  const base = { plan: f?.licencePlan ?? null, graceDays, notifyDays, maxStudents: f?.maxStudents ?? null, message: f?.licenceMessage ?? null };
  if (!f?.licencePaidUntil) return { ...base, state: 'ACTIVE', paidUntil: null, daysLeft: null, lockDate: null, summary: 'Active, with no end date' };
  const paidUntil = f.licencePaidUntil.toISOString().slice(0, 10);
  const daysLeft = daysBetween(today, paidUntil);
  const dates = { ...base, paidUntil, daysLeft, lockDate: plusDays(paidUntil, graceDays + 1) };
  if (f.licenceOverride) return { ...dates, state: 'ACTIVE', lockDate: null, summary: 'Active (kept on by the provider)' };
  if (daysLeft > notifyDays) return { ...dates, state: 'ACTIVE', summary: `Active until ${nice(paidUntil)}` };
  if (daysLeft >= 0) return { ...dates, state: 'DUE_SOON', summary: daysLeft === 0 ? 'The subscription ends today' : `The subscription ends on ${nice(paidUntil)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)` };
  if (-daysLeft <= graceDays) return { ...dates, state: 'GRACE', summary: `The subscription ended on ${nice(paidUntil)}. The system will lock on ${nice(dates.lockDate)} unless it is renewed.` };
  return { ...dates, state: 'LOCKED', summary: `The subscription ended on ${nice(paidUntil)} and the system is locked until it is renewed.` };
}

const FIELDS = { licencePlan: true, licencePaidUntil: true, licenceGraceDays: true, licenceNotifyDays: true, licenceOverride: true, licenceMessage: true, maxStudents: true, timezone: true } as const;
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; day: string; status: LicenceStatus }>();

/** The school's licence right now. */
export async function licenceStatus(schoolId: string): Promise<LicenceStatus> {
  const hit = cache.get(schoolId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: FIELDS });
  const status = evaluateLicence(school, dayInTimezone(school?.timezone || 'Asia/Karachi'));
  cache.set(schoolId, { at: Date.now(), day: '', status });
  return status;
}

export const forgetLicence = (schoolId: string) => { cache.delete(schoolId); };

/** What a locked school is told. */
export const LOCKED_MESSAGE = 'This school’s subscription has expired. Please contact your provider to renew it.';
