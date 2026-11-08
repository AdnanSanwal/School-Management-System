'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Last resort when even the root layout fails to render. It replaces the whole page, so it
// can't rely on the app's styles or components: plain HTML with inline styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#111827' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center', boxShadow: '0 10px 30px rgba(15,23,42,.08)' }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>The app hit a problem</h1>
            <p style={{ color: '#6b7280', fontSize: 14 }}>Please try again. If it keeps happening, tell the school office{error.digest ? ' and quote this code' : ''}.</p>
            {error.digest && <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af' }}>{error.digest}</p>}
            <button onClick={reset} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 12, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
