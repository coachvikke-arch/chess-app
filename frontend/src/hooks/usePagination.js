import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Rows per page for every long list in the app. */
export const PAGE_SIZE = 10;

/**
 * Slice a list into pages.
 *
 * `currentItems` is the slice to render, `totalPages` stays at least 1 so
 * callers never divide by zero, and `setPage` clamps to a real page.
 *
 * Options (all optional):
 *   pageKey    — URL query key, default `page`
 *   syncUrl    — keep the page in ?page= for refresh/Back (default true)
 *   resetKeys  — values that, when they change, send the list back to page 1
 *                (filter, tab, search …)
 *   scrollRef  — element scrolled to the top of the list on a page change
 */
export function usePagination(items, pageSize = PAGE_SIZE, options = {}) {
  const { pageKey = 'page', syncUrl = true, resetKeys = [], scrollRef = null } = options;

  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const [searchParams, setSearchParams] = useSearchParams();
  const urlPage = Math.max(1, parseInt(searchParams.get(pageKey) || '1', 10) || 1);

  /* With URL sync the query string is the only page state: no second copy can
     drift from it (and a remount simply re-reads ?page=). Lists that must keep
     their own counter (several open trackers on one page) use local state. */
  const [localPage, setLocalPage] = useState(1);
  const page = syncUrl ? urlPage : localPage;
  const currentPage = Math.min(page, totalPages);

  const writePage = useCallback(
    (next, replace) => {
      if (!syncUrl) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next <= 1) params.delete(pageKey);
          else params.set(pageKey, String(next));
          return params;
        },
        { replace }
      );
    },
    [pageKey, syncUrl, setSearchParams]
  );

  /* A new filter/tab/search starts at page 1. Compared against the previous
     token instead of "first render", so StrictMode's double-invoked mount
     effect does not rewrite a deep link. The effect deliberately does not
     depend on `writePage`: its identity follows the URL, and re-running on
     every page write would reset the page that was just chosen. */
  const resetToken = JSON.stringify(resetKeys || []);
  const lastResetToken = useRef(resetToken);
  useEffect(() => {
    if (lastResetToken.current === resetToken) return;
    lastResetToken.current = resetToken;
    if (syncUrl) writePage(1, true);
    else setLocalPage(1);
  }, [resetToken, syncUrl, writePage]);

  /* When rows disappear (a request accepted, a class deleted), a page can no
     longer exist. Fall back to the last real page. An empty list is skipped:
     while a request is loading the list is empty, and clamping then would
     throw away a ?page= deep link before the data arrives. */
  useEffect(() => {
    if (totalItems === 0) return;
    if (page <= totalPages) return;
    if (syncUrl) writePage(totalPages, true);
    else setLocalPage(totalPages);
  }, [page, totalPages, totalItems, syncUrl, writePage]);

  const setPage = useCallback(
    (next, { replace = false } = {}) => {
      const clamped = Math.min(Math.max(1, Number(next) || 1), totalPages);
      if (syncUrl) writePage(clamped, replace);
      else setLocalPage(clamped);
      scrollRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [totalPages, syncUrl, writePage, scrollRef]
  );

  const currentItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, currentPage, pageSize]);

  return { currentItems, currentPage, totalPages, setPage, totalItems };
}
