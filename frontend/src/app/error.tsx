'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-indigo-50/50 to-violet-50/50 p-6">
      <div className="w-full max-w-lg rounded-3xl border border-white/70 bg-white/90 backdrop-blur-md shadow-card-lg p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500 mt-2">
          The page failed to render. Try reloading this view.
        </p>
        {/* Internal error text can expose code details; show it only while developing. */}
        {process.env.NODE_ENV !== 'production' && error?.message && (
          <p className="mt-4 text-xs text-gray-400 break-words">{error.message}</p>
        )}
        {error?.digest && <p className="mt-4 font-mono text-xs text-gray-400">Error code: {error.digest}</p>}
        <button
          onClick={reset}
          className="btn-primary mt-6 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
