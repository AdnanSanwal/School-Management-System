import { basePrisma } from '../config/database';
import { runWithTenant } from '../config/tenancy';
import { dayInTimezone } from '../utils/dates';
import logger from '../utils/logger';
import { applyLateFines, sendFeeReminders } from '../modules/fees/fees.service';
import { sendLowAttendanceAlerts } from '../modules/attendance/lowAttendance';

/**
 * Daily automation, per school, after RUN_HOUR in the school's own timezone:
 *   every day — add late fees to overdue invoices
 *   Mondays   — fee due/overdue reminders, low-attendance alerts
 *
 * Every job is idempotent (fines mark the invoice; reminders/alerts de-duplicate per
 * day/month), so running twice — a restart, or two server instances — is harmless.
 * Turn off with JOBS_ENABLED=false.
 */
const RUN_HOUR = Number(process.env.JOBS_RUN_HOUR ?? 9);
const CHECK_EVERY_MS = 15 * 60_000;
const lastRun = new Map<string, string>(); // schoolId → YYYY-MM-DD

export async function runDailyJobsForSchool(schoolId: string, opts: { weekly: boolean }) {
  return runWithTenant(schoolId, async () => {
    const out: Record<string, unknown> = { fines: await applyLateFines() };
    if (opts.weekly) {
      out.reminders = await sendFeeReminders({ daysAhead: 3 });
      out.lowAttendance = await sendLowAttendanceAlerts();
    }
    return out;
  });
}

async function tick() {
  const schools = await basePrisma.school.findMany({ where: { isActive: true }, select: { id: true, code: true, timezone: true } });
  for (const s of schools) {
    const today = dayInTimezone(s.timezone);
    if (lastRun.get(s.id) === today) continue;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour < RUN_HOUR) continue;
    lastRun.set(s.id, today);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, weekday: 'long' }).format(new Date());
    try {
      const result = await runDailyJobsForSchool(s.id, { weekly: weekday === 'Monday' });
      logger.info('Daily jobs done', { school: s.code, result });
    } catch (err) {
      logger.error('Daily jobs failed', { school: s.code, message: (err as Error).message });
    }
  }
}

export function startDailyJobs() {
  if (process.env.JOBS_ENABLED === 'false' || process.env.NODE_ENV === 'test') return;
  const run = () => tick().catch((err) => logger.error('Daily job tick failed', { message: (err as Error).message }));
  setTimeout(run, 30_000); // after startup settles
  setInterval(run, CHECK_EVERY_MS).unref();
  logger.info(`Daily jobs scheduled (after ${RUN_HOUR}:00 school time)`);
}
