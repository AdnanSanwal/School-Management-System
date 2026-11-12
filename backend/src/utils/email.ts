import nodemailer, { Transporter } from 'nodemailer';
import logger from './logger';

// Outgoing email over SMTP. Configure either:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("true" for port 465)
// or just SENDGRID_API_KEY, which uses SendGrid's SMTP relay.
// With neither set, emails are skipped (and logged) instead of failing the request.

let transport: Transporter | null | undefined;

function mailer(): Transporter | null {
  if (transport !== undefined) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SENDGRID_API_KEY } = process.env;
  if (SMTP_HOST) {
    const port = Number(SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: SMTP_HOST, port, secure: SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS ?? '' } : undefined,
    });
  } else if (SENDGRID_API_KEY) {
    transport = nodemailer.createTransport({ host: 'smtp.sendgrid.net', port: 587, secure: false, auth: { user: 'apikey', pass: SENDGRID_API_KEY } });
  } else {
    transport = null;
  }
  return transport;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: EmailOptions) {
  if (process.env.NODE_ENV === 'test') return;
  const t = mailer();
  if (!t) {
    logger.warn('Email not sent: no SMTP_HOST or SENDGRID_API_KEY configured', { to, subject });
    return;
  }
  await t.sendMail({
    to,
    from: process.env.EMAIL_FROM || 'noreply@school.com',
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
  });
}

export async function sendSMS(to: string, body: string) {
  if (process.env.NODE_ENV === 'test') return;
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
}
