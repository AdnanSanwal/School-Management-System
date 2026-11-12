'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one search box used across the app (CR-06): a magnifying glass inside the field,
 * a clear (×) button that restores the full list, Esc to clear.
 *
 *   const [search, setSearch] = useState('');
 *   const term = useDebounced(search.trim(), 250);   // send `term` to the API
 *   <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, number…" />
 *   {rows.length === 0 && term && <NoMatches term={term} what="invoices" onClear={() => setSearch('')} />}
 */
export type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Classes for the wrapper (width etc.). */
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  /** Classes for the <input> itself. */
  inputClassName?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = 'Search…', className, autoFocus, onKeyDown, onFocus, inputClassName, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  const clear = () => { onChange(''); inner.current?.focus(); };
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <input
        ref={inner}
        type="search"
        className={cn('input pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden', inputClassName)}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        aria-label={rest['aria-label'] ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); onChange(''); }
        }}
      />
      {value && (
        <button type="button" onClick={clear} aria-label="Clear search" title="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});

/** `value`, but only after it has stopped changing for `ms` (default 250 ms). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Trims and collapses inner whitespace: "  ali   khan " → "ali khan". */
export function cleanTerm(term: string) {
  return term.trim().replace(/\s+/g, ' ');
}

/**
 * Client-side match used by lists filtered in the browser: case-insensitive, partial,
 * and every word of the term must appear somewhere ("khan ali" finds "Ali Raza Khan").
 */
export function matchesSearch(term: string, ...values: unknown[]) {
  const words = cleanTerm(term).toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = values.map(flatten).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function flatten(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(flatten).join(' ');
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(flatten).join(' ');
  return String(v);
}

/** Empty state for a search with no results, with a "Clear search" action. */
export function NoMatches({ term, what = 'results', onClear, children }: {
  term: string; what?: string; onClear: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="py-12 text-center">
      <Search className="mx-auto mb-2 h-8 w-8 text-gray-200" aria-hidden />
      <p className="font-medium text-gray-700">No {what} match “{cleanTerm(term)}”</p>
      <p className="mt-1 text-sm text-gray-500">{children ?? 'Check the spelling or try part of the name or number.'}</p>
      <button type="button" className="btn-secondary mt-3" onClick={onClear}>Clear search</button>
    </div>
  );
}
