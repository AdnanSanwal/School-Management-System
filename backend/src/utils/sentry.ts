import * as Sentry from '@sentry/node';
import { Express } from 'express';
import logger from './logger';

function getProfilingIntegration() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nodeProfilingIntegration } = require('@sentry/profiling-node');
    return nodeProfilingIntegration();
  } catch {
    logger.warn('Sentry profiling native module unavailable — profiling disabled');
    return null;
  }
}

export function initSentry(app: Express) {
  if (!process.env.SENTRY_DSN) {
    logger.warn('SENTRY_DSN not set — Sentry disabled');
    return;
  }

  const profiling = getProfilingIntegration();

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      ...(profiling ? [profiling] : []),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    profileSessionSampleRate: profiling ? 1.0 : 0,
    environment: process.env.NODE_ENV || 'development',
    // Student and staff records must not leave the school's servers in error reports (LOG-2).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  } as Parameters<typeof Sentry.init>[0]);

  logger.info('Sentry initialized');
}

// Sentry's express error handler — registers on app directly
export function setupSentryErrorHandler(app: Express) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.setupExpressErrorHandler(app);
}

export function captureError(err: Error, context?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/** Removes bodies, query strings (signed links), cookies, headers and user details from a Sentry event. */
export function scrubEvent<T extends { request?: Record<string, unknown>; user?: unknown; extra?: unknown; breadcrumbs?: unknown; spans?: unknown }>(event: T): T {
  if (event.request) {
    const url = typeof event.request.url === 'string' ? event.request.url.split('?')[0] : event.request.url;
    event.request = { method: event.request.method, url };
  }
  if (event.user) event.user = undefined;
  if (Array.isArray(event.spans)) {
    for (const s of event.spans as { description?: string; data?: Record<string, unknown> }[]) {
      if (typeof s.description === 'string') s.description = s.description.split('?')[0];
      if (s.data) for (const k of Object.keys(s.data)) if (/url|query|body/i.test(k)) delete s.data[k];
    }
  }
  return event;
}
