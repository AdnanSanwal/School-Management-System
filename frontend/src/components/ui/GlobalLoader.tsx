'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useIsFetching, type Query } from '@tanstack/react-query';
import { activity, useActivity } from '@/lib/activity';
import { useAuthStore } from '@/store/authStore';
import { LogoLoader } from './LogoLoader';

const SHOW_AFTER_MS = 350; // quick responses never show the loader
const HIDE_AFTER_MS = 150; // avoids flicker between back-to-back requests

/**
 * App-wide loading feedback:
 *  - a spinner with the school logo in the middle of the screen while a page opens,
 *    a screen's data loads for the first time, or a save runs (longer than a moment).
 *    Background refreshes of data already on screen, hover prefetches and
 *    search-as-you-type (meta.quiet) never show it.
 *  - while saving, the screen is blocked so nothing is submitted twice; while loading
 *    data you can still scroll and type
 *  - the button that started a save shows its own spinner too
 */
export function GlobalLoader() {
  const { writes, navigating } = useActivity();
  const loading = useIsFetching({ predicate: isFirstLoad });
  const logoUrl = useAuthStore((s) => s.user?.school?.logoUrl);
  const busy = loading + writes > 0 || navigating;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(busy), busy ? SHOW_AFTER_MS : HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  useBusyButton(writes);

  const blocking = writes > 0 || navigating;
  return (
    <>
      <Suspense fallback={null}><NavigationTracker /></Suspense>
      {visible && (
        <div className={`global-loader ${blocking ? 'global-loader-blocking' : ''}`}>
          <div className="global-loader-card">
            <LogoLoader logoUrl={logoUrl} label={writes > 0 ? 'Saving…' : 'Loading…'} />
          </div>
        </div>
      )}
    </>
  );
}

/** A query the user is waiting on: nothing to show yet, not a prefetch or search box. */
function isFirstLoad(q: Query) {
  return q.state.data === undefined && q.getObserversCount() > 0 && !q.meta?.quiet;
}

/** Marks navigation as started when an internal link is clicked, and done when the URL changes. */
function NavigationTracker() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => { activity.navigating(false); }, [pathname, search]);

  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      activity.navigating(true);
      clearTimeout(safety);
      safety = setTimeout(() => activity.navigating(false), 15_000);
    };
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); clearTimeout(safety); };
  }, []);

  return null;
}

/** Shows a spinner on the button the user just pressed while the save it started is running. */
function useBusyButton(writes: number) {
  const last = useRef<{ el: HTMLElement; at: number } | null>(null);
  const busyEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const remember = (el: HTMLElement | null) => { if (el) last.current = { el, at: Date.now() }; };
    const onClick = (e: MouseEvent) => remember((e.target as Element | null)?.closest?.('button') as HTMLElement | null);
    const onSubmit = (e: SubmitEvent) => remember((e.submitter as HTMLElement | null) ?? (e.target as HTMLFormElement).querySelector('button[type="submit"], button:not([type])'));
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('submit', onSubmit, true); };
  }, []);

  useEffect(() => {
    if (writes > 0) {
      const l = last.current;
      if (!busyEl.current && l && Date.now() - l.at < 1500 && l.el.isConnected) {
        busyEl.current = l.el;
        l.el.classList.add('is-busy');
        l.el.setAttribute('aria-busy', 'true');
      }
    } else {
      busyEl.current?.classList.remove('is-busy');
      busyEl.current?.removeAttribute('aria-busy');
      busyEl.current = null;
      last.current = null;
    }
  }, [writes]);
}
