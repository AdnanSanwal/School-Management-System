import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { emitToUsers } from './live';
import { Prisma } from '@prisma/client';
import { kickDeliveryWorker } from './notificationDelivery';
import { isRoutine, mutedList, quietUntil } from './notificationRules';

/**
 * One place that tells people something happened (spec §12 Notification System).
 *
 *   1. saves an in-app Notification row per user (the bell / alerts list), marked as
 *      waiting for delivery. This is awaited: once `notify` returns, the notification
 *      exists and its push is owed, whatever happens to the server afterwards;
 *   2. tells the user's open screens straight away (utils/live.ts);
 *   3. wakes the delivery worker, which pushes to phones and browsers with retries and
 *      falls back to a text for urgent types (utils/notificationDelivery.ts).
 *
 * Routine types respect each person's mutes and the school's quiet hours
 * (utils/notificationRules.ts): a muted one is saved but not pushed; one raised during
 * quiet hours is pushed when they end. Either way it is in the app's list at once.
 *
 * Works for one person or the whole school: rows are saved in bulk.
 */

export type NotificationType =
  | 'ATTENDANCE_ABSENT' | 'FEE_DUE' | 'FEE_PAID' | 'DIARY_POSTED' | 'NOTICE_PUBLISHED'
  | 'RESULT_PUBLISHED' | 'LEAVE_REQUESTED' | 'LEAVE_DECIDED' | 'LOW_ATTENDANCE' | 'PAYMENT_CLAIM' | 'BROADCAST'
  | 'EXPENSE_APPROVAL' | 'EXPENSE_DECIDED' | 'PAYROLL_APPROVAL' | 'PAYROLL_DECIDED' | 'PAYSLIP_READY';

export interface Message {
  type: NotificationType;
  title: string;
  body: string;
  /** Small JSON the app uses to open the right screen, e.g. { studentId } */
  data?: Record<string, string | number | boolean | null>;
}

export interface NotifyOptions {
  /** The office broadcast these belong to (for its delivery report). */
  broadcastId?: string;
}

const SAVE_PER_STATEMENT = 1000;

/** Same message to many users. Returns how many users were notified. */
export async function notify(userIds: Iterable<string>, msg: Message, opts: NotifyOptions = {}): Promise<number> {
  return notifyEach([...new Set(userIds)].map((userId) => ({ userId, ...msg })), opts);
}

/** Different message per user (e.g. each parent hears about their own child). */
export async function notifyEach(items: ({ userId: string } & Message)[], opts: NotifyOptions = {}): Promise<number> {
  if (!items.length) return 0;
  const schoolId = currentSchoolId();
  const createdAt = new Date();

  // Mutes and quiet hours only matter for routine types.
  const routineUsers = [...new Set(items.filter((i) => isRoutine(i.type)).map((i) => i.userId))];
  const [school, withMutes] = routineUsers.length
    ? await Promise.all([
        prisma.school.findUnique({ where: { id: schoolId }, select: { quietHoursStart: true, quietHoursEnd: true, timezone: true } }),
        prisma.user.findMany({ where: { id: { in: routineUsers }, NOT: { mutedNotifications: { equals: Prisma.AnyNull } } }, select: { id: true, mutedNotifications: true } }),
      ])
    : [null, []];
  const mutedBy = new Map(withMutes.map((u) => [u.id, new Set(mutedList(u.mutedNotifications))]));
  const holdUntil = school ? quietUntil(school, createdAt) : null;

  // Ids are made here so the live event can name the row without reading it back.
  const rows = items.map((i) => {
    const routine = isRoutine(i.type);
    const muted = routine && !!mutedBy.get(i.userId)?.has(i.type);
    return {
      muted,
      row: {
        id: randomUUID(), schoolId, userId: i.userId, type: i.type, title: i.title, body: i.body, data: i.data ?? undefined,
        createdAt, broadcastId: opts.broadcastId,
        // Muted: nothing to deliver. Otherwise owed now, or when quiet hours end.
        deliveryState: muted ? ('NONE' as const) : ('PENDING' as const),
        deliverAfter: muted ? null : routine && holdUntil ? holdUntil : createdAt,
      },
    };
  });
  for (let i = 0; i < rows.length; i += SAVE_PER_STATEMENT) {
    await prisma.notification.createMany({ data: rows.slice(i, i + SAVE_PER_STATEMENT).map((r) => r.row) });
  }

  await emitToUsers(schoolId, 'notification', rows.map(({ row, muted }) => ({
    userId: row.userId,
    // `quiet`: update the bell, but no pop-up.
    payload: { id: row.id, type: row.type, title: row.title, body: row.body, data: row.data ?? null, createdAt: createdAt.toISOString(), quiet: muted },
  })));
  kickDeliveryWorker();
  return new Set(items.map((i) => i.userId)).size;
}

// ─── Recipient helpers ───

/** Parent-app users linked to these students, with the student each one is about. */
export async function guardiansOf(studentIds: string[]) {
  if (!studentIds.length) return [];
  const links = await prisma.studentGuardian.findMany({
    where: { studentId: { in: studentIds }, guardian: { userId: { not: null } } },
    select: { studentId: true, guardian: { select: { userId: true } }, student: { select: { name: true } } },
  });
  return links.map((l) => ({ userId: l.guardian.userId!, studentId: l.studentId, studentName: l.student.name }));
}

/** Parent and student app users of active students in these sections. */
export async function familiesOfSections(sectionIds: string[]): Promise<string[]> {
  if (!sectionIds.length) return [];
  const students = await prisma.student.findMany({
    where: { sectionId: { in: sectionIds }, status: 'ACTIVE' },
    select: { id: true, userId: true },
  });
  const parents = await guardiansOf(students.map((s) => s.id));
  return [...new Set([...parents.map((p) => p.userId), ...students.map((s) => s.userId).filter((u): u is string => !!u)])];
}
