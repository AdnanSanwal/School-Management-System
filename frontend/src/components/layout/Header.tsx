'use client';

import { BranchSwitcher } from '@/components/brands/BranchSwitcher';
import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Settings, LogOut, ChevronRight, Check, X, Loader2, CornerDownLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { authAPI, notificationsAPI, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { SearchInput, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { searchAPI, matchingPages, type SearchGroup, type SearchItem } from '@/lib/searchApi';

interface HeaderProps {
  title: string;
}

// Breadcrumb auto-generator from pathname
function Breadcrumbs({ title }: { title: string }) {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length <= 1) return <h1 className="text-xl font-bold text-gray-900">{title}</h1>;
  return (
    <div className="flex items-center gap-1.5">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const label = isLast ? title : part.charAt(0).toUpperCase() + part.slice(1);
        return (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
            {isLast
              ? <span className="text-sm font-semibold text-gray-900">{label}</span>
              : <span className="text-sm text-gray-400 hover:text-gray-600 cursor-pointer capitalize">{label}</span>
            }
          </div>
        );
      })}
    </div>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsAPI.list().then(r => r.data.data),
  });

  const markAllMutation = useMutation({
    mutationFn: notificationsAPI.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOneMutation = useMutation({
    mutationFn: (id: string) => notificationsAPI.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = (notifications as any[]).filter((n: any) => !n.readAt).length;

  return (
    <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-card-lg border border-gray-100 overflow-hidden animate-slide-down z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm text-gray-900">Notifications</h3>
          {unread > 0 && (
            <span className="badge badge-indigo text-2xs">{unread} new</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unread > 0 && (
            <button onClick={() => markAllMutation.mutate()}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded-lg hover:bg-primary-50 transition-colors">
              <Check className="w-3 h-3" /> Mark all read
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto scrollbar-hide divide-y divide-gray-50">
        {(notifications as any[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="w-8 h-8 text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">All caught up!</p>
          </div>
        ) : (notifications as any[]).slice(0, 8).map((n: any) => (
          <button key={n.id} onClick={() => !n.readAt && markOneMutation.mutate(n.id)}
            className={cn('w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors', !n.readAt && 'bg-primary-50/40')}>
            <div className="flex items-start gap-3">
              <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', n.readAt ? 'bg-gray-200' : 'bg-primary-500')} />
              <div className="flex-1 min-w-0">
                <p className={cn('text-xs font-medium truncate', n.readAt ? 'text-gray-600' : 'text-gray-900')}>{n.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{n.body}</p>
                <p className="text-2xs text-gray-300 mt-1">{formatDateTime(n.createdAt)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-slate-50/50">
        <Link href="/notifications" onClick={onClose}
          className="flex items-center justify-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
          View all notifications <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function UserMenu({ onClose }: { onClose: () => void }) {
  const { user, clearAuth } = useAuthStore();
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOut = async () => {
    await authAPI.logout().catch(() => {});
    queryClient.clear();
    clearAuth();
    router.replace('/login');
  };
  const roleMeta: Record<string, { color: string; bg: string }> = {
    ADMIN:   { color: 'text-violet-700', bg: 'bg-violet-50' },
    TEACHER: { color: 'text-blue-700',   bg: 'bg-blue-50'   },
    STUDENT: { color: 'text-green-700',  bg: 'bg-green-50'  },
    PARENT:  { color: 'text-orange-700', bg: 'bg-orange-50' },
  };
  const meta = roleMeta[user?.role || ''] || { color: 'text-gray-600', bg: 'bg-gray-100' };
  const roleLabel = user?.role
    ? `${user.role.charAt(0)}${user.role.slice(1).toLowerCase()}`
    : 'User';

  return (
    <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl shadow-card-lg border border-gray-100 overflow-hidden animate-slide-down z-50">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-base font-bold text-primary-700">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.username ?? user?.email}</p>
          </div>
        </div>
        <span className={cn('mt-2 inline-block text-2xs font-semibold px-2 py-0.5 rounded-full', meta.bg, meta.color)}>
          {roleLabel}
        </span>
      </div>
      <div className="py-1.5">
        <Link href="/settings" onClick={onClose}
          className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
          <Settings className="w-4 h-4 text-gray-400" /> Settings
        </Link>
        <button onClick={() => { onClose(); signOut(); }}
          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}

/** Is the keyboard focus somewhere the user is typing? */
function typingIn(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/**
 * CR-06: "Search anything…". Students, staff, parents, classes, invoices, receipts, books and
 * logins from the server (only what this user may open), plus matching screens. ↑/↓ to move,
 * Enter to open, Esc to clear / close, Ctrl+K or "/" to focus from anywhere.
 */
function GlobalSearch() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // The highlighted row, remembered per search term so new results start at the top.
  const [sel, setSel] = useState({ term: '', i: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typed = cleanTerm(text);
  const term = useDebounced(typed, 250);
  const ready = term.length >= 2;

  const q = useQuery({
    queryKey: ['global-search', term],
    queryFn: ({ signal }) => searchAPI.all(term, signal),
    enabled: ready,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
    meta: { quiet: true },
  });

  const groups: SearchGroup[] = useMemo(() => {
    if (!ready) return [];
    const pages = matchingPages(term, role);
    const fromServer = q.data && q.data.q === term ? q.data.groups : [];
    return [...fromServer, ...(pages.length ? [{ key: 'pages', label: 'Pages', items: pages }] : [])];
  }, [ready, term, role, q.data]);
  const flat: SearchItem[] = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const waiting = typed !== term || (ready && q.isFetching && q.data?.q !== term);

  const active = sel.term === term ? sel.i : 0;
  const setActive = (f: (i: number) => number) => setSel({ term, i: f(active) });

  // Ctrl+K / Cmd+K anywhere, or "/" when not typing, focuses the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
      else if (e.key === '/' && !typingIn(e.target)) { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (item?: SearchItem) => {
    if (!item) return;
    setOpen(false);
    setText('');
    inputRef.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (flat.length ? (i + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!waiting) go(flat[active] ?? flat[0]); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (text) setText(''); else { setOpen(false); inputRef.current?.blur(); }
    }
  };

  let index = -1;
  return (
    <div ref={boxRef} className="relative hidden xl:block">
      <SearchInput
        ref={inputRef}
        value={text}
        onChange={(v) => { setText(v); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search anything…  (Ctrl+K)"
        aria-label="Search students, staff, invoices and more"
        className="w-56 transition-all duration-150 focus-within:w-80"
        inputClassName="py-2 rounded-xl border-white/60 bg-white/80 shadow-sm focus:bg-white"
      />
      {open && typed.length > 0 && (
        <div role="listbox" aria-label="Search results"
          className="absolute right-0 top-full z-50 mt-2 w-[26rem] max-w-[90vw] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card-lg animate-slide-down">
          {typed.length < 2 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Type at least 2 characters…</p>
          ) : waiting && !flat.length ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
          ) : q.isError && !flat.length ? (
            <p className="px-4 py-3 text-sm text-red-600">{apiError(q.error, 'Search failed — try again')}</p>
          ) : !flat.length ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-700">No matches for “{term}”</p>
              <p className="mt-1 text-xs text-gray-500">Try part of a name, an admission / employee no., a phone or an invoice no.</p>
              <button type="button" className="mt-2 text-xs font-medium text-primary-600 hover:underline" onClick={() => { setText(''); inputRef.current?.focus(); }}>Clear search</button>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto py-1">
              {groups.map((g) => (
                <div key={g.key} className="py-1">
                  <p className="px-4 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-gray-400">{g.label}</p>
                  {g.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <button key={`${g.key}:${item.id}`} type="button" role="option" aria-selected={i === active}
                        onMouseEnter={() => setActive(() => i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(item)}
                        className={cn('flex w-full items-center gap-3 px-4 py-2 text-left', i === active ? 'bg-primary-50' : 'hover:bg-gray-50')}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                          {item.subtitle && <p className="truncate text-xs text-gray-500">{item.subtitle}</p>}
                        </div>
                        {i === active && <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {waiting && <p className="flex items-center gap-2 px-4 py-2 text-xs text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Updating…</p>}
            </div>
          )}
          <div className="flex items-center gap-3 border-t border-gray-100 bg-slate-50/60 px-4 py-2 text-2xs text-gray-400">
            <span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to clear</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuthStore();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const notifsRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsAPI.list().then(r => r.data.data),
    refetchInterval: 30000,
  });
  const unreadCount = (notifications as any[]).filter((n: any) => !n.readAt).length;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) setShowNotifs(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUser(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-16 flex items-center justify-between px-6 flex-shrink-0 z-10 border-b border-white/70 bg-white/70 backdrop-blur-md">
      {/* Left: breadcrumb */}
      <Breadcrumbs title={title} />

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <BranchSwitcher />
        {/* Search */}
        <GlobalSearch />

        {/* Notification bell */}
        <div ref={notifsRef} className="relative">
          <button
            onClick={() => { setShowNotifs(v => !v); setShowUser(false); }}
            className={cn(
              'relative p-2.5 rounded-xl transition-colors',
              showNotifs ? 'bg-primary-50 text-primary-600 ring-1 ring-primary-200/70' : 'text-gray-500 hover:bg-white hover:text-gray-700 hover:shadow-sm'
            )}
          >
            <Bell className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {showNotifs && <NotificationPanel onClose={() => setShowNotifs(false)} />}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-200/70 mx-1" />

        {/* User avatar */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => { setShowUser(v => !v); setShowNotifs(false); }}
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl transition-colors',
              showUser ? 'bg-primary-50 ring-1 ring-primary-200/70' : 'hover:bg-white hover:shadow-sm'
            )}
          >
            <div className="w-8 h-8 rounded-xl bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700 flex-shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-gray-900 leading-tight">{user?.name?.split(' ')[0]}</p>
              <p className="text-2xs text-gray-400 leading-tight capitalize">{user?.role?.toLowerCase()}</p>
            </div>
            <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform hidden md:block', showUser && 'rotate-90')} />
          </button>
          {showUser && <UserMenu onClose={() => setShowUser(false)} />}
        </div>
      </div>
    </header>
  );
}
