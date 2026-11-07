// @ts-check
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone output for Docker; Netlify handles its own bundling without it
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  experimental: {
    instrumentationHook: true,
  },
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

module.exports = withSentryConfig(nextConfig, {
  // Sentry org + project from wizard
  org: 'orda-delivery',
  project: 'javascript-nextjs',

  // Only upload source maps in CI (requires SENTRY_AUTH_TOKEN)
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Hide source maps from browser DevTools in production
  hideSourceMaps: true,

  // Reduce logger noise
  disableLogger: true,
});
