import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from './Button';

/* ═══════════════════════ filter model (pure, no React) ═══════════════════════
   Kept out of the component so the combination rules can be tested directly.
   The panel edits a *draft* copy and only commits on Done, so everything below
   describes one snapshot of the filters. */

export const FILTER_DEFAULTS = {
  status: 'all',
  sort: 'latest',
  studentId: '',
};

export const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
];

/* Once a student is picked, "status" can only mean that student's progress - an
   assignment can be Active while one student is mid-way and another has handed
   it in, so the assignment-level chips would answer a question nobody asked.
   These are the tracker's own per-student states. */
export const STUDENT_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'overdue', label: 'Overdue' },
];

/** Which status axis applies to the current filters. */
export function statusFiltersFor(filters = {}) {
  return filters.studentId ? STUDENT_STATUS_FILTERS : STATUS_FILTERS;
}

export const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
];

/** How many filters are off their default - drives the "Filters (n)" badge. */
export function countActiveFilters(f = {}) {
  let n = 0;
  if (f.status && f.status !== FILTER_DEFAULTS.status) n += 1;
  if (f.sort && f.sort !== FILTER_DEFAULTS.sort) n += 1;
  if (f.studentId) n += 1;
  return n;
}

/**
 * Given out to students and still waiting on at least one of them.
 *
 * Not a stored-status test, and that is the whole point. The API's
 * `effectiveStatus` rewrites every past-due non-draft assignment to 'completed',
 * so a check against the status field ("is it active?", "is it overdue?") cannot
 * distinguish work that is genuinely outstanding from work that is finished -
 * and the old Overdue tab, which tested `status === 'active'`, was permanently
 * empty as a result. Assignment status is only ever draft/active/archived
 * (clamped at creation, assignmentController.js:205), so `pending` is derived
 * here from the counts the list rows already carry rather than matched as a
 * value that does not exist.
 */
export function isPending(a) {
  if (!a) return false;
  if (a.status === 'archived' || a.status === 'draft') return false;
  const total = Number(a.student_count || 0);
  if (total <= 0) return false;                  // nobody was given it
  return Number(a.completed_count || 0) < total; // somebody still owes work
}

/** Every student who appears on at least one assignment, deduped, name-sorted. */
export function collectStudents(assignments = []) {
  const byId = new Map();
  for (const a of assignments) {
    for (const ref of a?.student_refs || []) {
      if (ref && ref.id != null && !byId.has(ref.id)) {
        byId.set(ref.id, { id: ref.id, name: ref.name || `Student ${ref.id}` });
      }
    }
  }
  return [...byId.values()].sort((x, y) =>
    x.name.localeCompare(y.name) || x.id - y.id
  );
}

/** That student's status on one assignment, or null if they aren't on it. */
export function studentStatusFor(a, studentId) {
  if (!studentId) return null;
  const ref = (a?.student_refs || []).find((r) => Number(r?.id) === Number(studentId));
  return ref?.status || null;
}

/**
 * Status + student + sort, all at once.
 *
 * `search` is NOT handled here - it stays in the panel's own toolbar, layered on
 * top of this result, so the two stay independent.
 */
export function applyAssignmentFilters(assignments = [], filters = {}) {
  const f = { ...FILTER_DEFAULTS, ...filters };
  let out = assignments.filter((a) => {
    /* A selected student makes status mean THEIR status, so the assignment's own
       status is not consulted at all - the two are different questions. */
    if (f.studentId) {
      const status = studentStatusFor(a, f.studentId);
      if (!status) return false;
      if (f.status !== 'all' && status !== f.status) return false;
    } else if (f.status === 'pending') {
      if (!isPending(a)) return false;
    } else if (f.status !== 'all') {
      if (a.status !== f.status) return false;
    }

    return true;
  });

  // Stable sort: equal dates keep the API's newest-first order, so "Latest" is a
  // genuine no-op rather than a shuffle.
  const dir = f.sort === 'oldest' ? 1 : -1;
  out = out
    .map((a, i) => ({ a, i, k: new Date(a.created_at || 0).getTime() || 0 }))
    .sort((x, y) => (x.k === y.k ? x.i - y.i : (x.k < y.k ? -dir : dir)))
    .map((x) => x.a);

  return out;
}

/* ═══════════════════════════════ the panel ═══════════════════════════════ */

const chipBase =
  'px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70';
const chipOn = 'bg-red-500 border-red-500 text-white shadow-sm';
const chipOff = 'bg-black/5 border-ivory-700/50 text-ivory-500 hover:border-ivory-500/60 hover:text-ivory-300';

export default function AssignmentFilterPanel({ open, value, students, onApply, onClose }) {
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const [q, setQ] = useState('');
  const panelRef = useRef(null);
  const firstFieldRef = useRef(null);

  /* Reopening shows the applied filters, never the last abandoned draft. */
  useEffect(() => {
    if (open) {
      setDraft(value);
      setQ('');
    }
  }, [open, value]);

  /* Focus moves into the drawer when it opens. Returning it is the caller's
     job: the trigger button lives in the toolbar, and this component is
     unmounted (not set to open=false) on close, so an effect here would never
     get the chance to run. */
  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  const patch = useCallback((next) => setDraft((d) => ({ ...d, ...next })), []);

  /* Switching axis can strand the status: "Draft" is an assignment state and is
     not one of a student's, so carrying it over would filter to nothing. It
     resets to All, which is also the honest reading - the coach changed
     question. */
  const onStudentChange = useCallback((studentId) => {
    setDraft((d) => {
      const allowed = statusFiltersFor({ ...d, studentId }).map((s) => s.value);
      return { ...d, studentId, status: allowed.includes(d.status) ? d.status : 'all' };
    });
  }, []);

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

  const dirty = countActiveFilters(draft) > 0;
  const statusFilters = statusFiltersFor(draft);

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
            Narrow assignments by status, student, or sort order.
          </p>
        </header>

        {/* Scrolls on its own so the action bar stays reachable on a short screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ivory-400">
              Status
            </legend>
            <div className="flex flex-wrap gap-2">
              {statusFilters.map((s, i) => (
                <button
                  key={s.value}
                  type="button"
                  ref={i === 0 ? firstFieldRef : undefined}
                  aria-pressed={draft.status === s.value}
                  onClick={() => patch({ status: s.value })}
                  className={`${chipBase} ${draft.status === s.value ? chipOn : chipOff}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ivory-400">
              Sort
            </legend>
            <div role="radiogroup" aria-label="Sort assignments" className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.sort === o.value}
                  onClick={() => patch({ sort: o.value })}
                  className={`${chipBase} ${draft.sort === o.value ? chipOn : chipOff}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-5">
            <label
              htmlFor="assignment-filter-student"
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ivory-400"
            >
              Student
            </label>
            <StudentCombobox
              students={students}
              value={draft.studentId}
              query={q}
              setQuery={setQ}
              onChange={onStudentChange}
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-ivory-700/40 px-5 py-4">
          <Button
            type="button"
            onClick={() => {
              setDraft(FILTER_DEFAULTS);
              setQ('');
            }}
            disabled={!dirty}
            variant="secondary" size="sm" className="!px-4 !py-2 text-xs"
          >
            Clear filters
          </Button>
          <Button
            type="button"
            onClick={() => onApply(draft)}
            variant="primary" size="sm" className="ml-auto !px-5 !py-2 text-xs"
          >
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* ─────────────── searchable single-select student field ─────────────── */

function StudentCombobox({ students, value, query, setQuery, onChange }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
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

  const selected = students.find((s) => String(s.id) === String(value)) || null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        String(s.id).includes(needle)
    );
  }, [students, query]);

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
          id="assignment-filter-student"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Select student"
          autoComplete="off"
          value={open ? query : selected ? `${selected.name} (ID ${selected.id})` : ''}
          placeholder="Select student"
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
          Clear student
        </button>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Students"
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
              All students
            </button>
          </li>
          {matches.length === 0 && (
            <li className="px-3 py-2 text-xs text-ivory-500">No student matches “{query.trim()}”.</li>
          )}
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={String(s.id) === String(value)}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${
                  i === active ? 'bg-ivory-700/25 text-ivory-100' : 'text-ivory-300'
                }`}
              >
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[0.6rem] text-ivory-500">ID {s.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}