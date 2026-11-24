import { z } from 'zod';
import type { AttendanceStatus } from '@prisma/client';
import prisma, { ScopedTx } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { AppError } from '../../middleware/errorHandler';
import { dayInTimezone, toDate, tzOffsetMinutes } from '../../utils/dates';

export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const policyBody = z.object({
  enabled: z.boolean(), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a => new Set(a).size === a.length, 'Duplicate working day'),
  startTime: clock, endTime: clock, graceMinutes: z.number().int().min(0).max(120),
  earlyMinutes: z.number().int().min(0).max(240), minimumMinutes: z.number().int().min(1).max(720),
  gpsRequired: z.boolean(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
  radiusMeters: z.number().int().min(25).max(5000), maxAccuracyMeters: z.number().int().min(5).max(500),
  correctionDays: z.number().int().min(1).max(90),
}).strict().superRefine((p, ctx) => {
  if (p.endTime <= p.startTime) ctx.addIssue({ code: 'custom', message: 'End time must be after start time; overnight shifts are not supported', path: ['endTime'] });
  if (p.minimumMinutes > minutes(p.endTime) - minutes(p.startTime)) ctx.addIssue({ code: 'custom', message: 'Minimum duration cannot exceed the scheduled shift', path: ['minimumMinutes'] });
  if (p.gpsRequired && (p.latitude === null || p.longitude === null)) ctx.addIssue({ code: 'custom', message: 'Set the branch latitude and longitude before enabling GPS', path: ['latitude'] });
});
export type Policy = z.infer<typeof policyBody>;
export const DEFAULT_POLICY: Policy = { enabled: false, weekdays: [1,2,3,4,5], startTime: '08:00', endTime: '15:00', graceMinutes: 15, earlyMinutes: 60, minimumMinutes: 240, gpsRequired: false, latitude: null, longitude: null, radiusMeters: 150, maxAccuracyMeters: 100, correctionDays: 31 };
export const locationBody = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000), capturedAt: z.string().datetime() }).strict();
export const punchBody = z.object({ location: locationBody.optional() }).strict();
export const minutes = (clock: string) => Number(clock.slice(0,2))*60 + Number(clock.slice(3));
export function localInstant(date: string, clock: string, timezone: string) {
  const wall = new Date(`${date}T${clock}:00Z`);
  let result = wall;
  for (let i=0;i<3;i++) result = new Date(wall.getTime() - tzOffsetMinutes(timezone, result)*60000);
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(result);
  if (dayInTimezone(timezone,result)!==date || parts!==clock) throw new AppError('This local time does not exist in the branch timezone',422);
  return result;
}
export function distanceMeters(a: number, b: number, c: number, d: number) {
  const rad = (n:number) => n*Math.PI/180;
  const h = Math.sin(rad(c-a)/2)**2 + Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function verifyLocation(policy: Policy, location: z.infer<typeof locationBody> | undefined, now: Date) {
  if (!policy.gpsRequired) return { gps: 'not-required' };
  if (!location) throw new AppError('Your current GPS location is required by this branch',422);
  const age = now.getTime()-new Date(location.capturedAt).getTime();
  if (age < -30000 || age > 120000) throw new AppError('Location is stale. Request your current location again.',422);
  if (location.accuracy>policy.maxAccuracyMeters) throw new AppError('GPS accuracy is too low. Move to an open area and try again.',422);
  if (policy.latitude===null || policy.longitude===null) throw new AppError('Branch GPS rules are incomplete',409);
  const distance = distanceMeters(policy.latitude,policy.longitude,location.latitude,location.longitude);
  if (distance>policy.radiusMeters) throw new AppError('You are outside the branch attendance radius',403);
  // Keep only verification evidence, not staff members' raw coordinates.
  return { gps:'verified', distanceMeters:Math.round(distance), accuracyMeters:Math.round(location.accuracy) };
}
export async function getPolicy() {
  const saved = await prisma.staffAttendancePolicy.findUnique({where:{schoolId:currentSchoolId()}});
  return saved ? policyBody.parse({ ...Object.fromEntries(Object.keys(DEFAULT_POLICY).map(k=>[k,(saved as any)[k]])) }) : DEFAULT_POLICY;
}
export async function lockStaff(tx:ScopedTx, staffId:string) {
  await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} AND schoolId = ${currentSchoolId()} FOR UPDATE`;
}
export async function assertAttendanceOpen(tx:ScopedTx, date:Date) {
  const period = date.toISOString().slice(0,7);
  const school = await tx.school.findUniqueOrThrow({where:{id:currentSchoolId()},select:{booksClosedThrough:true}});
  if (school.booksClosedThrough && period<=school.booksClosedThrough) throw new AppError('Attendance belongs to a closed accounting month',409);
  const runs = await tx.$queryRaw<{status:string}[]>`SELECT status FROM payroll_runs WHERE schoolId = ${currentSchoolId()} AND period = ${period} FOR UPDATE`;
  if (runs.some(run=>run.status!=='DRAFT')) throw new AppError('Payroll for this month is submitted, approved or paid. Reopen an unpaid run before correcting attendance.',409);
}
export function snapshot(row: { id:string; status:AttendanceStatus; checkIn:Date|null; checkOut:Date|null; updatedAt:Date } | null) {
  return row ? { id:row.id,status:row.status,checkIn:row.checkIn?.toISOString()??null,checkOut:row.checkOut?.toISOString()??null,version:row.updatedAt.toISOString() } : {};
}
export async function attendanceEvent(tx:ScopedTx, actor:string, staffId:string, date:string, action:string, meta:Record<string,unknown>={}) {
  await tx.auditLog.create({data:{schoolId:currentSchoolId(),userId:actor,entity:'staff_attendance',entityId:staffId,action,meta:JSON.parse(JSON.stringify({date,...meta}))}});
}
export async function assertWorkingDay(date:string, policy:Policy) {
  if (!policy.weekdays.includes(toDate(date).getUTCDay())) throw new AppError('Today is not a scheduled working day for this branch',409);
  if (await prisma.calendarEvent.findFirst({where:{type:'HOLIDAY',startDate:{lte:toDate(date)},endDate:{gte:toDate(date)}}})) throw new AppError('Today is a branch holiday',409);
}
