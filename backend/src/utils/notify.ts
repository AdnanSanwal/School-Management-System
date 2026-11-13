import webpush from 'web-push';
import prisma, { basePrisma } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import logger from './logger';

/**
 * One place that tells people something happened (spec §12 Notification System).
 *
 *   1. saves an in-app Notification row per user (the bell / alerts list) — awaited;
 *   2. pushes to phones (Expo push API) and browsers (Web Push) — in the background,
 *      so a slow push service never delays the request;
 *   3. emits a socket event so open screens update live.
 *
 * Push is skipped when PUSH_DISABLED=true or NODE_ENV=test.
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

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

function pushEnabled() {
  return process.env.PUSH_DISABLED !== 'true' && process.env.NODE_ENV !== 'test';
}

/** Same message to many users. Returns how many users were notified. */
export async function notify(userIds: Iterable<string>, msg: Message): Promise<number> {
  return notifyEach([...new Set(userIds)].map((userId) => ({ userId, ...msg })));
}

/** Different message per user (e.g. each parent hears about their own child). */
export async function notifyEach(items: ({ userId: string } & Message)[]): Promise<number> {
  if (!items.length) return 0;
  const schoolId = currentSchoolId();
  await prisma.notification.createMany({
    data: items.map((i) => ({ schoolId, userId: i.userId, type: i.type, title: i.title, body: i.body, data: i.data ?? undefined })),
  });

  emitLive(items);
  if (pushEnabled()) {
    // Not awaited: delivery happens after the response is sent.
    deliverPush(items, schoolId).catch((err) => logger.warn('Push delivery failed', { message: (err as Error).message }));
  }
  return new Set(items.map((i) => i.userId)).size;
}

function emitLive(items: ({ userId: string } & Message)[]) {
  try {
    // Lazy require: socket.ts is only initialised by the server, not in tests/scripts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require('../config/socket');
    const io = getIO();
    for (const i of items) io.to(`school:${currentSchoolId()}:user:${i.userId}`).emit('notification', { type: i.type, title: i.title, body: i.body, data: i.data });
  } catch {
    /* socket server not running */
  }
}

async function deliverPush(items: ({ userId: string } & Message)[], schoolId: string) {
  const userIds = [...new Set(items.map((i) => i.userId))];
  // Unscoped on purpose: runs after the request's tenant context may be gone; filtered by user ids.
  const [devices, subs] = await Promise.all([
    basePrisma.deviceToken.findMany({ where: { schoolId, userId: { in: userIds } }, select: { token: true, userId: true } }),
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? basePrisma.pushSubscription.findMany({ where: { schoolId, userId: { in: userIds } } })
      : Promise.resolve([]),
  ]);

  const byUser = new Map(items.map((i) => [i.userId, i]));

  // ─── Expo (mobile) ───
  const expoMessages = devices.map((d) => {
    const m = byUser.get(d.userId)!;
    return { to: d.token, title: m.title, body: m.body, data: { type: m.type, ...(m.data ?? {}), schoolId }, sound: 'default', channelId: 'default' };
  });
  for (let i = 0; i < expoMessages.length; i += 100) {
    const chunk = expoMessages.slice(i, i + 100);
    const res = await fetch(EXPO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) { logger.warn('Expo push HTTP error', { status: res.status }); continue; }
    const { data } = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
    // Forget devices that uninstalled the app or revoked permission.
    const dead = data.map((r, j) => (r.details?.error === 'DeviceNotRegistered' ? chunk[j].to : null)).filter(Boolean) as string[];
    if (dead.length) await basePrisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
  }

  // ─── Web push (browser) ───
  if (subs.length) {
    webpush.setVapidDetails(`mailto:${process.env.EMAIL_FROM || 'admin@school.com'}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    await Promise.allSettled(subs.map(async (s) => {
      const m = byUser.get(s.userId)!;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: m.title, body: m.body, url: '/notifications' }));
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await basePrisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }));
  }
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
