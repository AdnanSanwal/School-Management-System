import * as Sentry from '@sentry/nextjs';

// Error reporting is off unless the school/platform sets its own Sentry project
// (NEXT_PUBLIC_SENTRY_DSN, baked in at build time). Reports may contain student data,
// so they must only ever go to an account you control.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  // No session replay: it would record screens with children's names, photos and fees.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Don't send the query string or form contents.
  integrations: dsn ? [Sentry.feedbackIntegration({ colorScheme: 'system', showBranding: false })] : [],
  debug: false,
});
