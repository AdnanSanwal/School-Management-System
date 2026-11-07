import crypto from 'crypto';
import type { MessagingChannel } from '@prisma/client';
import prisma, { basePrisma } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import logger from './logger';
import type { NotificationType } from './notify';

/**
 * WhatsApp / SMS alerts to guardians' phones (spec §12 "Push + Optional SMS").
 *
 * Unlike push (app users only), this reaches every family through the primary
 * guardian's phone number. Each school chooses the channel and which alert types
 * go out (School settings); nothing is sent unless the school turns it on.
 *
 * Providers are pluggable (MESSAGING_PROVIDER):
 *   test   — logs and marks messages sent; for development and tests
 *   twilio — Twilio Programmable Messaging (SMS, and WhatsApp via "whatsapp:" senders)
 * Add another provider by implementing `MessagingDriver` and registering it below.
 */

export interface MessagingDriver {
  name: string;
  send(to: string, body: string, channel: MessagingChannel): Promise<{ ok: boolean; ref?: string; error?: string }>;
}

const testDriver: MessagingDriver = {
  name: 'test',
  async send(to, body, channel) {
    logger.info('Test messaging driver', { channel, to, body: body.slice(0, 80) });
    return { ok: true, ref: `TEST-${crypto.randomBytes(4).toString('hex')}` };
  },
};

const twilioDriver: MessagingDriver = {
  name: 'twilio',
  async send(to, body, channel) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = channel === 'WHATSAPP' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !from) return { ok: false, error: `Twilio is not configured for ${channel}` };
    const prefix = channel === 'WHATSAPP' ? 'whatsapp:' : '';
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: `${prefix}${to}`, From: from.startsWith('whatsapp:') || !prefix ? from : `${prefix}${from}`, Body: body }),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return res.ok ? { ok: true, ref: json.sid } : { ok: false, error: json.message ?? `HTTP ${res.status}` };
  },
};

const DRIVERS: Record<string, MessagingDriver> = { test: testDriver, twilio: twilioDriver };

export function activeDriver(): MessagingDriver | null {
  const name = process.env.MESSAGING_PROVIDER;
  return name ? DRIVERS[name] ?? null : null;
}

/**
 * Normalises a phone number to E.164. Local numbers use DEFAULT_COUNTRY_CODE
 * (92, Pakistan): "0300-1234567" → "+923001234567". Returns null if unusable.
 */
export function toE164(raw: string | null | undefined, countryCode = process.env.DEFAULT_COUNTRY_CODE || '92'): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  let n: string;
  if (digits.startsWith('+')) n = digits;
  else if (digits.startsWith('00')) n = `+${digits.slice(2)}`;
  else if (digits.startsWith('0')) n = `+${countryCode}${digits.slice(1)}`;
  else if (digits.startsWith(countryCode)) n = `+${digits}`;
  else n = `+${countryCode}${digits}`;
  return /^\+\d{10,15}$/.test(n) ? n : null;
}

/** Message types a school can switch on. */
export const MESSAGE_TYPES: NotificationType[] = ['ATTENDANCE_ABSENT', 'FEE_DUE', 'FEE_PAID', 'RESULT_PUBLISHED', 'LOW_ATTENDANCE'];

/**
 * Texts the primary guardian of each student (one message per phone per call).
 * Returns how many messages were queued; 0 if the school hasn't enabled this type.
 */
export async function messageFamilies(type: NotificationType, items: { studentId: string; body: string }[], opts: { oncePerDays?: number } = {}): Promise<number> {
  if (!items.length) return 0;
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: currentSchoolId() }, select: { name: true, messagingEnabled: true, messagingChannel: true, messagingTypes: true },
  });
  const types = Array.isArray(school.messagingTypes) ? (school.messagingTypes as string[]) : [];
  if (!school.messagingEnabled || !types.includes(type)) return 0;

  const links = await prisma.studentGuardian.findMany({
    where: { studentId: { in: items.map((i) => i.studentId) } },
    orderBy: { isPrimary: 'desc' },
    select: { studentId: true, guardian: { select: { phone: true } } },
  });
  const phoneOf = new Map<string, string>();
  for (const l of links) {
    const p = toE164(l.guardian.phone);
    if (p && !phoneOf.has(l.studentId)) phoneOf.set(l.studentId, p);
  }
  // Optional throttle: skip phones that already got this alert type recently.
  const recent = opts.oncePerDays
    ? new Set((await prisma.outboundMessage.findMany({
        where: { type, createdAt: { gte: new Date(Date.now() - opts.oncePerDays * 86_400_000) }, to: { in: [...phoneOf.values()] } },
        select: { to: true },
      })).map((m) => m.to))
    : new Set<string>();
  const seen = new Set<string>(recent);
  const rows = items.flatMap((i) => {
    const to = phoneOf.get(i.studentId);
    const body = `${school.name}: ${i.body}`.slice(0, 600);
    const key = `${to}|${body}`;
    if (!to || seen.has(to) || seen.has(key)) return [];
    seen.add(key);
    if (opts.oncePerDays) seen.add(to);
    return [{ schoolId: currentSchoolId(), type, channel: school.messagingChannel, to, body, provider: activeDriver()?.name ?? 'none' }];
  });
  if (!rows.length) return 0;

  const created = await Promise.all(rows.map((data) => prisma.outboundMessage.create({ data, select: { id: true, to: true, body: true, channel: true } })));
  if (process.env.NODE_ENV === 'test' && process.env.MESSAGING_PROVIDER !== 'test') return created.length;
  deliver(created).catch((err) => logger.warn('Messaging delivery failed', { message: (err as Error).message }));
  return created.length;
}

/** Sends queued messages and records the outcome. Runs after the request returns. */
export async function deliver(messages: { id: string; to: string; body: string; channel: MessagingChannel }[]) {
  const driver = activeDriver();
  for (const m of messages) {
    if (!driver) {
      await basePrisma.outboundMessage.update({ where: { id: m.id }, data: { status: 'FAILED', error: 'No messaging provider configured (MESSAGING_PROVIDER)' } });
      continue;
    }
    try {
      const r = await driver.send(m.to, m.body, m.channel);
      await basePrisma.outboundMessage.update({ where: { id: m.id }, data: r.ok ? { status: 'SENT', providerRef: r.ref ?? null } : { status: 'FAILED', error: r.error ?? 'Unknown error' } });
    } catch (err) {
      await basePrisma.outboundMessage.update({ where: { id: m.id }, data: { status: 'FAILED', error: (err as Error).message } });
    }
  }
}
