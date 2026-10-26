import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { Spinner, Bar } from './ui';
import PuzzleReviewModal from './PuzzleReviewModal';
import AssignmentFilterPanel, {
  FILTER_DEFAULTS,
  applyAssignmentFilters,
  collectStudents,
  countActiveFilters,
  statusFiltersFor,
  studentStatusFor,
} from './AssignmentFilterPanel';
import Button from './Button';
import Pagination, { PAGE_SIZE } from './Pagination';
import { usePagination } from '../hooks/usePagination';

/* ── status pills, reusing the site's gold/green/red tokens ── */
const PA_STATUS = {
  draft: { label: 'Draft', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  active: { label: 'Active', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  in_progress: { label: 'In progress', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  completed: { label: 'Completed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  submitted: { label: 'Submitted', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  overdue: { label: 'Overdue', cls: 'bg-red-500/10 border-red-500/30 text-red-500' },
  pending: { label: 'Pending', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  archived: { label: 'Archived', cls: 'bg-ivory-700/20 border-ivory-700/40 text-ivory-400' },
};

export function StatusPill({ status }) {
  const m = PA_STATUS[status] || PA_STATUS.pending;
  return (
    <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border whitespace-nowrap ${m.cls}`}>
      {m.label}
    </span>
  );
}

const LIST_TABS = ['all', 'draft', 'active', 'completed', 'pending'];
const SUB_TABS = ['all', 'pending', 'in_progress', 'submitted', 'reviewed', 'overdue'];

const LABELS = {
  all: 'All', draft: 'Draft', active: 'Active', completed: 'Completed', pending: 'Pending',
  /* The tracker still has a real per-student 'overdue' - that one comes from the
     submissions query, not from effectiveStatus - so it keeps its own label. */
  overdue: 'Overdue',
  in_progress: 'In Progress', submitted: 'Submitted', reviewed: 'Reviewed',
};
const tabLabel = (t) => LABELS[t] || t;

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Coach puzzle assignments — the assignments list (screen 1) and the
 * per-assignment student tracker (screen 2). The move-by-move review
 * (screen 3) opens in PuzzleReviewModal.
 */
export default function PuzzleAssignmentsPanel() {
  const [assignments, setAssignments] = useState([]);
  const [sets, setSets] = useState([]);
  /* One filter snapshot, not one per control. The quick tabs below and the
     filter drawer both read and write `filters.status`, so they cannot drift
     into disagreeing about which status is showing. */
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /* Owned here because the button that opens the drawer lives here, and closing
     it must hand keyboard focus straight back to that button. */
  const filterBtnRef = useRef(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);        // assignment id being tracked
  const [tracker, setTracker] = useState(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [subTab, setSubTab] = useState('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [reviewId, setReviewId] = useState(null);     // submission id → review modal
  const listTopRef = useRef(null);

  /* Both exits - Done and dismiss - return focus to the button that opened the
     drawer, so a keyboard user is never dropped at the top of the page. */
  const closeFilters = useCallback(() => {
    setFiltersOpen(false);
    filterBtnRef.current?.focus();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        api.get('/assignments/puzzle-assignments').then((r) => r.data).catch(() => []),
        api.get('/assignments/puzzle-assignments/sets').then((r) => r.data).catch(() => []),
      ]);
      setAssignments(Array.isArray(a) ? a : []);
      setSets(Array.isArray(s) ? s : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* The student list comes from the assignments themselves, so the dropdown can
     only ever offer students the coach can actually filter down to. */
  const filterStudents = useMemo(() => collectStudents(assignments), [assignments]);
  const activeFilterCount = countActiveFilters(filters);
  /* Name as well as id: while filtering by a student, each row is labelled with
     whose status it is showing. */
  const focusStudent = useMemo(
    () => filterStudents.find((s) => String(s.id) === String(filters.studentId)) || null,
    [filterStudents, filters.studentId]
  );

  const filtered = useMemo(() => {
    let src = applyAssignmentFilters(assignments, filters);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(
        (a) =>
          (a.title || '').toLowerCase().includes(q) ||
          (a.set_name || '').toLowerCase().includes(q) ||
          (a.folder_name || '').toLowerCase().includes(q) ||
          // Match an assigned student by name — the list shows who got the work.
          (a.student_names || []).some((n) => String(n).toLowerCase().includes(q))
      );
    }
    return src;
  }, [assignments, filters, search]);

  /* Status tabs, the filter drawer and search all describe a different list,
     so any of them sends the worklist back to page 1. */
  const pager = usePagination(filtered, PAGE_SIZE, {
    resetKeys: [filters, search],
    scrollRef: listTopRef,
  });

  const openTracker = async (id) => {
    if (openId === id) { setOpenId(null); setTracker(null); return; }
    setOpenId(id);
    setSubTab('all');
    setStudentSearch('');
    setTrackerLoading(true);
    try {
      const res = await api.get(`/assignments/puzzle-assignments/${id}/students`);
      setTracker(res.data);
    } catch { setTracker(null); }
    setTrackerLoading(false);
  };

  const students = useMemo(() => {
    let src = tracker?.students || [];
    if (subTab !== 'all') src = src.filter((s) => s.status === subTab);
    if (studentSearch.trim()) {
      const q = studentSearch.trim().toLowerCase();
      src = src.filter(
        (s) => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)
      );
    }
    return src;
  }, [tracker, subTab, studentSearch]);

  const refreshTracker = async () => {
    if (!openId) return;
    try {
      const res = await api.get(`/assignments/puzzle-assignments/${openId}/students`);
      setTracker(res.data);
    } catch { /* ignore */ }
  };

  if (loading) return <Spinner text="Loading puzzle assignments…" />;

  return (
    <div>
      <Toolbar
        filters={filters} setFilters={setFilters}
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        filterBtnRef={filterBtnRef}
        search={search} setSearch={setSearch}
        onCreate={() => setCreating(true)}
      />

      {filtered.length === 0 ? (
        <div className="chess-card text-center py-14">
          <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">♞</span>
          <p className="chess-empty">
            {activeFilterCount > 0
              ? 'No results found'
              : search.trim()
                ? `No assignment matches “${search.trim()}”.`
                : 'No puzzle assignments here. Create one from a puzzle set.'}
          </p>
          {activeFilterCount > 0 && (
            <Button
              type="button"
              onClick={() => setFilters(FILTER_DEFAULTS)}
              variant="secondary" size="sm" className="mt-4 !px-4 !py-2 text-xs"
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
        <div ref={listTopRef} className="space-y-3">
          {pager.currentItems.map((a) => (
            <AssignmentCard
              key={a.id}
              a={a}
              focusStudent={focusStudent}
              isOpen={openId === a.id}
              onToggle={() => openTracker(a.id)}
              tracker={openId === a.id ? tracker : null}
              trackerLoading={openId === a.id ? trackerLoading : false}
              subTab={subTab} setSubTab={setSubTab}
              studentSearch={studentSearch} setStudentSearch={setStudentSearch}
              search={search}
              onReview={setReviewId}
            />
          ))}
        </div>

        <Pagination
          currentPage={pager.currentPage}
          totalPages={pager.totalPages}
          totalItems={pager.totalItems}
          onPageChange={pager.setPage}
          itemLabel="assignments"
        />
        </>
      )}

      {filtersOpen && (
        <AssignmentFilterPanel
          open
          value={filters}
          students={filterStudents}
          onApply={(next) => {
            setFilters(next);
            closeFilters();
          }}
          onClose={closeFilters}
        />
      )}

      {creating && (
        <CreateModal
          sets={sets}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); }}
        />
      )}
      {reviewId && (
        <PuzzleReviewModal
          submissionId={reviewId}
          onClose={() => { setReviewId(null); refreshTracker(); }}
        />
      )}
    </div>
  );
}

/* ──────────────── list filter bar ──────────────── */

function Toolbar({ filters, setFilters, activeFilterCount, onOpenFilters, filterBtnRef, search, setSearch, onCreate }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {LIST_TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setFilters({ ...filters, status: t })}
          className={`chess-chip ${filters.status === t ? 'chess-chip-gold' : ''}`}
        >
          {tabLabel(t)}
        </button>
      ))}
      <input
        placeholder="Search assignment, set or student…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="chess-input !text-xs w-full sm:w-64 ml-auto"
      />
      {/* The count is what tells a coach the list is narrowed - a bare filter
          icon next to the results looks identical whether it is doing anything. */}
      <button
        type="button"
        ref={filterBtnRef}
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        className={`chess-chip ${activeFilterCount > 0 ? 'chess-chip-red' : ''}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 2.5h13L9.5 8.5v4.5l-3 1.5V8.5L1.5 2.5Z" />
        </svg>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>
      <Button type="button" onClick={onCreate} variant="primary" size="sm" className="!text-xs !px-3 !py-1.5">
        + Create Assignment
      </Button>
    </div>
  );
}

/* ──────────────── one assignment row + its student tracker ──────────────── */

function AssignmentCard({ a, isOpen, onToggle, tracker, trackerLoading, onReview, search, focusStudent, ...trackerProps }) {
  const names = a.student_names || [];
  /* Filtering by a student means the status shown must be THAT student's, or the
     list contradicts the chips the coach just set (an Active assignment with
     "Reviewed" under a student filter). */
  const focusStatus = studentStatusFor(a, focusStudent?.id);
  // When the coach searched by student name, show who matched so the result
  // explains itself instead of looking like a random assignment.
  const q = (search || '').trim().toLowerCase();
  const matched = q ? names.filter((n) => String(n).toLowerCase().includes(q)) : [];
  return (
    <div className="chess-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ivory-100 flex items-center gap-2 flex-wrap">
            <span className="text-gold-400">♞</span>
            {a.title}
            {a.is_template && (
              <span className="text-[0.6rem] px-2 py-0.5 rounded-full border border-gold-500/30 text-gold-500">
                Template
              </span>
            )}
          </p>
          <p className="text-xs text-ivory-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>🧩 {a.puzzle_count} puzzle{a.puzzle_count !== 1 ? 's' : ''}</span>
            <span>Max attempts: <span className="text-ivory-300">{a.max_attempts}</span></span>
            {a.set_name && <span>Set: <span className="text-gold-400">{a.set_name}</span></span>}
            <span>Assigned: <span className="text-ivory-300">{fmtDate(a.created_at)}</span></span>
            {a.due_date && <span>⚑ Due {fmtDate(a.due_date)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focusStatus ? (
            <>
              <span className="text-[0.6rem] text-ivory-500">{focusStudent.name}</span>
              <StatusPill status={focusStatus} />
            </>
          ) : (
            <StatusPill status={a.status} />
          )}
          <Button
            type="button"
            onClick={onToggle}
            variant="secondary" size="sm" className="!px-3 !py-1 text-xs whitespace-nowrap"
          >
            {isOpen ? 'Hide' : 'Track students'}
          </Button>
        </div>
      </div>

      {/* completion progress — computed from submissions */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[0.65rem] text-ivory-500 shrink-0">
          {a.completed_count}/{a.student_count} students completed
        </span>
        <span className="flex-1"><Bar pct={a.completionPct} /></span>
        <span className="text-[0.6rem] text-ivory-500 shrink-0">{a.completionPct}%</span>
      </div>

      {/* assigned students — a few names, or the ones that matched the search */}
      {names.length > 0 && (
        <p className="mt-2 text-[0.65rem] text-ivory-500 flex flex-wrap items-center gap-1">
          <span className="shrink-0">♙</span>
          {(matched.length > 0 ? matched : names.slice(0, 6)).map((n, i) => (
            <span
              key={n}
              className={`px-1.5 py-0.5 rounded-full border ${matched.length > 0
                  ? 'border-gold-500/40 bg-gold-500/10 text-gold-400'
                  : 'border-ivory-700/40 text-ivory-400'
                }`}
            >
              {n}
            </span>
          ))}
          {matched.length === 0 && names.length > 6 && (
            <span className="text-ivory-500">+{names.length - 6} more</span>
          )}
          {matched.length > 1 && (
            <span className="text-ivory-500">+{matched.length - 1} more matching</span>
          )}
        </p>
      )}

      {isOpen && (
        <div className="mt-4 pt-4 border-t border-ivory-700/40" style={{ animation: 'board-pop .25s both' }}>
          <StudentTracker
            tracker={tracker}
            loading={trackerLoading}
            onReview={onReview}
            {...trackerProps}
          />
        </div>
      )}
    </div>
  );
}

/* ──────────────── per-assignment student tracker ──────────────── */

function StudentTracker({ tracker, loading, subTab, setSubTab, studentSearch, setStudentSearch, onReview }) {
  const all = tracker?.students || [];
  const listTopRef = useRef(null);

  const students = useMemo(() => {
    let src = all;
    if (subTab !== 'all') src = src.filter((s) => s.status === subTab);
    if (studentSearch.trim()) {
      const q = studentSearch.trim().toLowerCase();
      src = src.filter(
        (s) => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)
      );
    }
    return src;
  }, [all, subTab, studentSearch]);

  /* Several assignments can be open at once, so each tracker keeps its own
     page instead of sharing ?page=. */
  const pager = usePagination(students, PAGE_SIZE, {
    syncUrl: false,
    resetKeys: [subTab, studentSearch],
    scrollRef: listTopRef,
  });

  if (loading) return <Spinner text="Loading students…" />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {SUB_TABS.map((t) => {
          const n = t === 'all' ? all.length : all.filter((s) => s.status === t).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setSubTab(t)}
              className={`chess-chip text-[0.65rem] ${subTab === t ? 'chess-chip-gold' : ''}`}
            >
              {tabLabel(t)}: {n}
            </button>
          );
        })}
        <input
          placeholder="Search student…"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
          className="chess-input !text-xs w-full sm:w-48 ml-auto"
        />
      </div>

      {students.length === 0 ? (
        <p className="text-sm text-ivory-500">
          {all.length ? 'No students match this filter.' : 'No students assigned yet.'}
        </p>
      ) : (
        <>
        <ul ref={listTopRef} className="space-y-1.5">
          {pager.currentItems.map((s) => (
            <StudentRow key={s.submissionId} s={s} onReview={() => onReview(s.submissionId)} />
          ))}
        </ul>
        <Pagination
          currentPage={pager.currentPage}
          totalPages={pager.totalPages}
          totalItems={pager.totalItems}
          onPageChange={pager.setPage}
          itemLabel="students"
        />
        </>
      )}
    </>
  );
}

function StudentRow({ s, onReview }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-ivory-700/40 bg-black/[0.02] px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm text-ivory-300">{s.name}</span>
        <span className="text-[0.6rem] text-ivory-500">ID {s.studentId}</span>
      </span>

      <span className="flex items-center gap-2 min-w-[10rem] flex-1">
        <span className="text-[0.65rem] text-ivory-500 shrink-0 w-20">
          {s.progressCompleted}/{s.progressTotal} puzzles
        </span>
        <span className="flex-1"><Bar pct={s.progressPct} /></span>
      </span>

      <span className="text-[0.65rem] text-ivory-500 shrink-0">
        {s.attemptCount} attempt{s.attemptCount !== 1 ? 's' : ''} · {s.points} pts
      </span>
      <StatusPill status={s.status} />
      <span className="text-[0.65rem] text-ivory-500 shrink-0">
        {s.submittedAt ? `📅 ${fmtDate(s.submittedAt)}` : '—'}
      </span>
      <Button
        type="button"
        onClick={onReview}
        variant="secondary" size="sm" className="!px-3 !py-1 text-xs shrink-0"
      >
        Review
      </Button>
    </li>
  );
}

/* ──────────────── Create Assignment modal ──────────────── */

function CreateModal({ sets, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [setCode, setSetCode] = useState(sets[0]?.code || '');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('active');
  const [isTemplate, setIsTemplate] = useState(false);
  const [assignAll, setAssignAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = sets.find((s) => s.code === setCode);

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!setCode) { setError('Pick a puzzle set'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/assignments/puzzle-assignments', {
        title: title.trim(),
        setCode,
        maxAttempts: Number(maxAttempts) || 1,
        dueDate: dueDate || null,
        status,
        isTemplate,
      });
      if (assignAll) {
        await api.post(`/assignments/puzzle-assignments/${res.data.id}/assign`, { allStudents: true });
      }
      await onCreated();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create the assignment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] overflow-y-auto bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        className="chess-card max-w-lg w-full flex flex-col max-h-[94vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'board-pop .3s both' }}
      >
        <h2 className="font-display text-xl font-semibold text-ivory-100 mb-4">Create Puzzle Assignment</h2>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg border border-red-400/30 bg-red-500/10 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ivory-500">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Mate in 4 — set 1"
              className="chess-input !text-xs w-full"
            />
          </label>

          <label className="block">
            <span className="text-xs text-ivory-500">Puzzle set</span>
            <select value={setCode} onChange={(e) => setSetCode(e.target.value)} className="chess-input !text-xs w-full">
              <option value="">Select a set…</option>
              {sets.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.folder_name ? `${s.folder_name} / ` : ''}{s.name} ({s.puzzle_count} puzzles)
                </option>
              ))}
            </select>
            {selected && (
              <span className="text-[0.6rem] text-ivory-500 mt-1 block">
                {selected.puzzle_count} puzzles · {selected.total_points} total points
              </span>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ivory-500">Max attempts</span>
              <input
                type="number" min="1"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                className="chess-input !text-xs w-full"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ivory-500">Due date</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="chess-input !text-xs w-full" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-ivory-500">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="chess-input !text-xs w-full">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-ivory-500">
            <input type="checkbox" checked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} className="accent-[#93c5fd]" />
            Assign to all active students
          </label>
          <label className="flex items-center gap-2 text-xs text-ivory-500">
            <input type="checkbox" checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} className="accent-[#93c5fd]" />
            Save as Template
          </label>
        </div>

        <div className="flex gap-3 mt-auto pt-4">
          <Button disabled={busy} type="button" onClick={onClose} variant="secondary" size="md" className="flex-1">Cancel</Button>
          <Button disabled={busy} type="button" onClick={submit} variant="primary" size="md" className="flex-1">
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

