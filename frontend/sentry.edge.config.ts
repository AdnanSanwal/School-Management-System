import * as Sentry from '@sentry/nextjs';

// Off unless SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) points at your own Sentry project.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  debug: false,
});
