import { useMemo } from 'react';
import { PAGE_SIZE } from '../hooks/usePagination';

export { PAGE_SIZE };

/* Compact page window: always keeps the first and last page, plus two either
   side of the current one, with a single ellipsis where a run is skipped.
   e.g. page 5 of 12 → 1 … 3 4 5 6 7 … 12 */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  const out = [1];
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < totalPages - 1) out.push('…');
  out.push(totalPages);
  return out;
}

/**
 * Shared list pager: ◀ 1 2 3 ▶ centred under the list, with a
 * "Showing X–Y of N" line. It renders nothing when everything fits on one
 * page, so callers do not need their own "is it worth showing?" branch.
 * On phones the middle numbers collapse to the current page; the arrows and
 * the range line still say where you are.
 */
export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  totalItems = 0,
  pageSize = PAGE_SIZE,
  itemLabel = 'items',
  className = '',
}) {
  const pages = useMemo(() => pageWindow(currentPage, totalPages), [currentPage, totalPages]);
  if (!totalPages || totalPages <= 1 || totalItems === 0) return null;

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);
  const go = (next) => {
    const clamped = Math.min(Math.max(next, 1), totalPages);
    if (clamped !== currentPage) onPageChange?.(clamped);
  };

  return (
    <nav className={`mg-pager ${className}`} aria-label="Pagination">
      <div className="mg-pager-controls">
        <button
          type="button"
          className="mg-pager-btn"
          onClick={() => go(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ◀
        </button>

        <div className="mg-pager-nums">
          {pages.map((item, i) =>
            item === '…' ? (
              <span key={`gap-${i}`} className="mg-pager-gap" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={`mg-pager-num${item === currentPage ? ' is-active' : ''}`}
                onClick={() => go(item)}
                aria-label={`Page ${item}`}
                aria-current={item === currentPage ? 'page' : undefined}
              >
                {item}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          className="mg-pager-btn"
          onClick={() => go(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >
          ▶
        </button>
      </div>

      <p className="mg-pager-range" aria-live="polite">
        Showing {from}–{to} of {totalItems} {itemLabel}
      </p>
    </nav>
  );
}
