// @ts-check
const { withSentryConfig } = require('@sentry/nextjs');

const isDev = process.env.NODE_ENV !== 'production';

/** Origin of an absolute URL, or '' for relative ones like "/api/v1". */
const originOf = (url) => { try { return url && /^https?:/.test(url) ? new URL(url).origin : ''; } catch { return ''; } };

/**
 * Content-Security-Policy: scripts, styles and data only from this site, the API and
 * (if configured) your own Sentry. Blocks injected third-party scripts and framing by
 * other sites (clickjacking). Next.js needs inline scripts for hydration.
 */
function securityHeaders() {
  // Must match the address the browser really calls: same fallback as src/lib/api.ts.
  // ("/api/v1" behind Caddy = this site, so nothing extra is allowed.)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
  const api = originOf(apiUrl);
  const sentry = process.env.NEXT_PUBLIC_SENTRY_DSN ? 'https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io' : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${api.replace(/^http/, 'ws')} ${sentry}${isDev ? ' ws: http://localhost:*' : ''}`,
    `frame-src 'self' ${api}`, // signed PDF report cards/receipts open from the API
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when the API is this site or https: upgrading a plain-http API (a local production
    // run on http://localhost:5000) would break every request.
    ...(!isDev && (!api || api.startsWith('https:')) ? ['upgrade-insecure-requests'] : []),
  ].map((d) => d.replace(/\s+/g, ' ').trim()).join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  // A second dev server (e.g. next to a running production build) needs its own build folder.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // standalone output for Docker; Netlify handles its own bundling without it
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  images: {
    remotePatterns: [
      { protocol: 'http',  hostname: 'localhost' },
      { protocol: 'https', hostname: 'school-management-files.s3.amazonaws.com' },
    ],
  },
  // When the browser calls a relative API URL (NEXT_PUBLIC_API_URL=/api/v1) and no
  // reverse proxy sits in front, Next forwards /api/* to the backend. In production
  // Caddy sends /api/* straight to the backend, so this is only a fallback.
  async rewrites() {
    const target = process.env.API_PROXY_URL || 'http://localhost:5000/api';
    return [{ source: '/api/:path*', destination: `${target.replace(/\/$/, '')}/:path*` }];
  },
};

// Sentry is only wired in for production builds that have your own project's key
// (NEXT_PUBLIC_SENTRY_DSN). Dev compiles stay fast, and nothing is reported anywhere
// without a key. Source maps are uploaded only when SENTRY_AUTH_TOKEN is also set.
const useSentryPlugin = process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN;

module.exports = !useSentryPlugin ? nextConfig : withSentryConfig(nextConfig, {
  // Your own Sentry project (only used to upload source maps when SENTRY_AUTH_TOKEN is set).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  silent: true,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Hide source maps from browser DevTools in production
  hideSourceMaps: true,

  // Reduce logger noise
  disableLogger: true,
});
