import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from './Button';

/* ═══════════════════════ filter model (pure, no React) ═══════════════════════
   The homework list is narrowed by the server, so these helpers only describe
   one snapshot of the drawer's own fields. Status lives in the toolbar chips
   and search in the toolbar box, exactly as they do on the assignment worklist,
   so none of them are counted here. */

export const HOMEWORK_FILTER_DEFAULTS = {
  classId: '',
  studentId: '',
  dueFrom: '',
  dueTo: '',
};

/** How many drawer fields are off their default - drives "Filters (n)". */
export function countHomeworkFilters(f = {}) {
  return Object.keys(HOMEWORK_FILTER_DEFAULTS)
    .filter((key) => String(f[key] ?? '').trim() !== '')
    .length;
}

const chipBase =
  'px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70';
const chipOn = 'bg-blue-600 border-blue-600 text-white shadow-sm';
const chipOff = 'bg-black/5 border-ivory-700/50 text-ivory-500 hover:border-ivory-500/60 hover:text-ivory-300';

/**
 * Admin homework filter drawer — the same surface, spacing and behaviour as the
 * assignment worklist's panel: right-edge sheet, chip groups, searchable
 * single-selects, and a Clear/Done bar that stays reachable on a short screen.
 * It edits a draft and commits only on Done.
 */
export default function HomeworkFilterPanel({ open, value, classes = [], students = [], onApply, onClose }) {
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const panelRef = useRef(null);
  const firstFieldRef = useRef(null);

  /* Reopening shows the applied filters, never the last abandoned draft. */
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  const patch = useCallback((next) => setDraft((d) => ({ ...d, ...next })), []);

  /* Escape closes, Tab is trapped inside the dialog. */
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes || nodes.length === 0) return;
    const list = [...nodes].filter((n) => n.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const dirty = countHomeworkFilters(draft) > 0;

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex justify-end" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="filter-drawer relative flex w-full max-w-sm flex-col border-l border-ivory-700/40 bg-ink-900 shadow-2xl"
      >
        <header className="shrink-0 border-b border-ivory-700/40 px-5 py-4">
          <h2 id={titleId} className="font-display text-xl font-semibold text-ivory-100">
            Filters
          </h2>
          <p className="mt-1 text-xs text-ivory-500">
            Narrow homework by class, student or due date.
          </p>
        </header>

        {/* Scrolls on its own so the action bar stays reachable on a short screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5">
            <label
              htmlFor="homework-filter-class"
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ivory-400"
            >
              Class
            </label>
            <OptionCombobox
              id="homework-filter-class"
              items={classes.map((c) => ({ id: c.id, name: c.name }))}
              value={draft.classId}
              onChange={(classId) => patch({ classId })}
              allLabel="All classes"
              placeholder="Select class"
              clearLabel="Clear class"
              inputRef={firstFieldRef}
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="homework-filter-student"
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ivory-400"
            >
              Student
            </label>
            <OptionCombobox
              id="homework-filter-student"
              items={students.map((s) => ({ id: s.id, name: s.name }))}
              value={draft.studentId}
              onChange={(studentId) => patch({ studentId })}
              allLabel="All students"
              placeholder="Select student"
              clearLabel="Clear student"
            />
          </div>

          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ivory-400">
              Due date
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${chipBase} ${draft.dueFrom ? chipOn : chipOff}`}>
                <span className="mr-1.5 opacity-70">From</span>
                <input
                  type="date"
                  value={draft.dueFrom}
                  onChange={(e) => patch({ dueFrom: e.target.value })}
                  className="bg-transparent text-xs font-semibold outline-none"
                  aria-label="Due from"
                />
              </label>
              <label className={`${chipBase} ${draft.dueTo ? chipOn : chipOff}`}>
                <span className="mr-1.5 opacity-70">To</span>
                <input
                  type="date"
                  value={draft.dueTo}
                  onChange={(e) => patch({ dueTo: e.target.value })}
                  className="bg-transparent text-xs font-semibold outline-none"
                  aria-label="Due to"
                />
              </label>
              {(draft.dueFrom || draft.dueTo) && (
                <button
                  type="button"
                  onClick={() => patch({ dueFrom: '', dueTo: '' })}
                  className="text-[0.65rem] text-ivory-500 underline hover:text-ivory-300"
                >
                  Clear dates
                </button>
              )}
            </div>
          </fieldset>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-ivory-700/40 px-5 py-4">
          <Button
            type="button"
            onClick={() => setDraft(HOMEWORK_FILTER_DEFAULTS)}
            disabled={!dirty}
            variant="secondary" size="sm" className="!px-4 !py-2 text-xs"
          >
            Clear filters
          </Button>
          <Button
            type="button"
            onClick={() => onApply({ ...draft })}
            variant="primary" size="sm" className="ml-auto !px-5 !py-2 text-xs"
          >
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* ─────────────── searchable single-select field ─────────────── */

function OptionCombobox({
  id, items, value, onChange, allLabel, placeholder, clearLabel, inputRef,
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selected = items.find((s) => String(s.id) === String(value)) || null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((s) => String(s.name).toLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    setActive(matches.length ? 0 : -1);
  }, [matches]);

  const choose = (s) => {
    onChange(s ? String(s.id) : '');
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (matches.length === 0) return;
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + matches.length) % matches.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
      return;
    }
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={placeholder}
          autoComplete="off"
          value={open ? query : selected ? selected.name : ''}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="chess-input !pr-8 !text-xs"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.6rem] text-ivory-500">
          ▼
        </span>
      </div>

      {selected && !open && (
        <button
          type="button"
          onClick={() => choose(null)}
          className="mt-1.5 text-[0.65rem] text-ivory-500 underline hover:text-ivory-300"
        >
          {clearLabel}
        </button>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={allLabel}
          className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-ivory-700/50 bg-ink-800 py-1 shadow-xl"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              onClick={() => choose(null)}
              className="block w-full px-3 py-2 text-left text-xs text-ivory-400 hover:bg-ivory-700/20"
            >
              {allLabel}
            </button>
          </li>
          {matches.length === 0 && (
            <li className="px-3 py-2 text-xs text-ivory-500">Nothing matches “{query.trim()}”.</li>
          )}
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={String(s.id) === String(value)}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={`block w-full truncate px-3 py-2 text-left text-xs ${
                  i === active ? 'bg-ivory-700/25 text-ivory-100' : 'text-ivory-300'
                }`}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
