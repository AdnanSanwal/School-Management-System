import type { QueryClient } from '@tanstack/react-query';
import { academicsAPI, approvalsAPI, dashboardAPI, feesAPI, libraryAPI, noticesAPI, staffAPI, studentsAPI, transportAPI } from '@/lib/api';
import { todayIso } from '@/lib/utils';

// Data each main page shows first, so hovering its sidebar link can load it before the click.
// Keys and arguments MUST match the page's own useQuery with its default filters, or the
// page simply fetches again (harmless, just no speed-up).
const PAGE_QUERIES: Record<string, () => { queryKey: unknown[]; queryFn: () => Promise<unknown> }[]> = {
  '/dashboard': () => [{ queryKey: ['dashboard'], queryFn: dashboardAPI.overview }],
  '/approvals': () => [{ queryKey: ['approvals'], queryFn: approvalsAPI.inbox }],
  '/students': () => [{
    queryKey: ['students', { search: '', sectionId: '', status: 'ACTIVE', page: 1 }],
    queryFn: () => studentsAPI.list({ search: undefined, sectionId: undefined, status: 'ACTIVE', page: 1, limit: 25 }),
  }],
  '/staff': () => [{ queryKey: ['staff', 'ACTIVE', ''], queryFn: () => staffAPI.list({ status: 'ACTIVE', search: undefined, limit: 200 }) }],
  '/classes': () => [{ queryKey: ['classes'], queryFn: academicsAPI.classes }],
  '/notices': () => [{ queryKey: ['notices'], queryFn: () => noticesAPI.list({ limit: 50 }) }],
  '/fees/invoices': () => {
    const period = todayIso().slice(0, 7);
    return [
      { queryKey: ['classes'], queryFn: academicsAPI.classes },
      { queryKey: ['invoices', period, '', '', 1], queryFn: () => feesAPI.invoices({ period, classId: undefined, status: undefined, page: 1, limit: 50 }) },
    ];
  },
  '/transport': () => [{ queryKey: ['transport', 'routes'], queryFn: transportAPI.routes }],
  '/library': () => [{ queryKey: ['library', 'issues', 'open', 1], queryFn: () => libraryAPI.issues({ status: 'open', page: 1, limit: 25 }) }],
};

const PREFETCH_FRESH_MS = 30_000; // don't refetch on every hover

/** Start loading a page's data (e.g. on link hover). Quiet: never shows the loader. */
export function prefetchPage(qc: QueryClient, href: string) {
  const queries = PAGE_QUERIES[href]?.();
  if (!queries) return;
  for (const q of queries) qc.prefetchQuery({ ...q, staleTime: PREFETCH_FRESH_MS }).catch(() => {});
}
