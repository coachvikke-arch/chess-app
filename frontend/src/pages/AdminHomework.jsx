import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { clearHttpCache } from '../services/api';
import { Page, Spinner, ConfirmDialog } from '../components/ui';
import Pagination from '../components/Pagination';
import Button from '../components/Button';
import PuzzleAssignPicker from '../components/PuzzleAssignPicker';
import HomeworkFilterPanel, {
  HOMEWORK_FILTER_DEFAULTS,
  countHomeworkFilters,
} from '../components/HomeworkFilterPanel';
import StudentAttemptDrawer from '../components/StudentAttemptDrawer';

const PAGE_SIZE = 10;

const STUDENT_STATUS = {
  pending: { label: 'Pending', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  in_progress: { label: 'In Progress', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  submitted: { label: 'Submitted', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  overdue: { label: 'Overdue', cls: 'bg-red-500/10 border-red-500/30 text-red-600' },
};

/* The four states the tabs offer. They are derived on the server (see
   homeworkController.listHomework) from the assignment and its submissions, so
   the badge on a card and the tab that selected it always agree. */
const HOMEWORK_STATUS = {
  draft: { label: 'Draft', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  active: { label: 'Active', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  pending: { label: 'Pending', cls: 'bg-blue-500/10 border-blue-500/30 text-blue-600' },
  completed: { label: 'Completed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'pending', label: 'Pending' },
];

const EMPTY_FILTERS = { ...HOMEWORK_FILTER_DEFAULTS, search: '' };

/* ── the address holds the view ────────────────────────────────────────────
   Page, status tab and every filter go into the query string, so turning a page
   cannot quietly change what is selected, a refresh comes back to the same
   slice, and the state survives the last card on a page being deleted. The keys
   are the same words the fetch params use, matching the shared pager's `page`. */
const PAGE_PARAM = 'page';
const STATUS_PARAM = 'status';
const FILTER_PARAMS = { search: 'search', classId: 'classId', studentId: 'studentId', dueFrom: 'dueFrom', dueTo: 'dueTo' };

function readListState(sp) {
  const filters = { ...HOMEWORK_FILTER_DEFAULTS };
  for (const [key, param] of Object.entries(FILTER_PARAMS)) {
    filters[key] = sp.get(param) || '';
  }
  const status = sp.get(STATUS_PARAM) || 'all';
  return {
    page: Math.max(1, parseInt(sp.get(PAGE_PARAM), 10) || 1),
    status: TABS.some((t) => t.key === status) ? status : 'all',
    filters,
  };
}

/* Written from the address it is replacing, so a parameter this list does not
   own — one another component put there — survives the page turn. Only the
   seven keys above are touched, and a key at its default is removed. */
function writeListState(current, { page, status, filters }) {
  const sp = new URLSearchParams(current);
  const set = (param, value) => (value ? sp.set(param, value) : sp.delete(param));
  set(PAGE_PARAM, page > 1 ? String(page) : '');
  set(STATUS_PARAM, status !== 'all' ? status : '');
  for (const [key, param] of Object.entries(FILTER_PARAMS)) {
    set(param, String(filters[key] ?? '').trim());
  }
  return sp;
}

/* The trash can, drawn rather than an emoji so it inherits the button's colour
   and turns red with the hover. */
function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4h11M6.2 4V2.5h3.6V4M4.2 4l.7 9.5h6.2L11.8 4M6.6 6.5v4.6M9.4 6.5v4.6" />
    </svg>
  );
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

/**
 * Admin Homework — every puzzle assignment made from the Puzzle Library, with a
 * submitted/total count. Status tabs and the Filters panel narrow the list
 * together (AND); opening a card fetches per-student progress from
 * GET /api/homework/:id/progress (the same tracker the coach already uses).
 */
export default function AdminHomework() {
  const [searchParams, setSearchParams] = useSearchParams();
  /* The address is read once, on mount, and only seeds the state. Reading it
     live would give the router a second say over `page`, which the page-change
     handlers below already own. */
  const seedRef = useRef(null);
  if (seedRef.current === null) seedRef.current = readListState(searchParams);

  const [page, setPage] = useState(seedRef.current.page);
  const [status, setStatus] = useState(seedRef.current.status);
  const [filters, setFilters] = useState(seedRef.current.filters);
  const [data, setData] = useState({ items: [], counts: null, total: 0, totalPages: 1 });
  /* Two busy states, because they deserve two treatments: `loading` is the list
     with nothing on screen yet (a spinner is honest), `updating` is a page turn
     over cards that are already there (they stay, dimmed, until the next page
     arrives — that is what stops the blink and the layout jump). */
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const hasCardsRef = useRef(false);

  const [panelOpen, setPanelOpen] = useState(false);
  /* The search box lives in the toolbar, not the drawer — like the worklist it
     narrows the list as you type, so the typed value is kept apart from the
     debounced one that goes into the query. */
  const [searchInput, setSearchInput] = useState(seedRef.current.filters.search);
  const filterBtnRef = useRef(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);

  const [assignOpen, setAssignOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef(null);

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null); // { students: [...] }
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  /* The homework awaiting confirmation, and the one mid-deletion. */
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  /* The student whose attempts are open in the drawer, with the pill the row was
     showing: the drawer must repeat the status the coach just read, and that is
     the derived one (overdue, "solved everything"), not the stored column. */
  const [review, setReview] = useState(null); // { student, badge } | null

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  }

  const load = useCallback(async () => {
    if (hasCardsRef.current) setUpdating(true);
    else setLoading(true);
    setError('');
    try {
      const params = { page, limit: PAGE_SIZE };
      if (status !== 'all') params.status = status;
      for (const [key, value] of Object.entries(filters)) {
        if (String(value).trim() !== '') params[key] = String(value).trim();
      }
      const res = await api.get('/homework', { params });
      const next = res.data || {};
      hasCardsRef.current = (next.items?.length || 0) > 0;
      setData(next);
      if (page > (next.totalPages || 1)) setPage(next.totalPages || 1);
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to load homework';
      /* A refresh that fails while cards are on screen is a toast, not a
         full-page error card: what the coach is reading stays put. */
      if (hasCardsRef.current) showToast(message);
      else setError(message);
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }, [page, status, filters]);

  useEffect(() => { load(); }, [load]);

  /* Mirror the view into the address. `replace` because a page turn is not a
     visit — it must not stack history entries the back button has to claw
     through — and the string compare because writing the address the router
     just handed back would re-render this route forever. */
  useEffect(() => {
    const next = writeListState(searchParams, { page, status, filters });
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [page, status, filters, searchParams]);

  /* Filter options come from the same endpoints the rest of the admin screens
     use: classes are `groups`, students are the roster. */
  useEffect(() => {
    api.get('/groups').then((res) => setClasses(res.data || [])).catch(() => {});
    api.get('/students').then((res) => setStudents(res.data || [])).catch(() => {});
  }, []);

  /* The toolbar search box is debounced before it reaches the query: the list is
     narrowed by the server, so a typed word must not fire one request per
     keystroke. The ref is why the reset below is conditional — the timer also
     fires 350ms after mount and after any unrelated render, and an
     unconditional setPage(1) there is what used to snap the coach back to page
     one while nothing about the search had changed. */
  const appliedSearchRef = useRef(seedRef.current.filters.search);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (appliedSearchRef.current === searchInput) return;
      appliedSearchRef.current = searchInput;
      setFilters((f) => ({ ...f, search: searchInput }));
      setPage(1);
      setOpenId(null);
      setDetail(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* Both exits — Done and dismiss — hand focus back to the chip that opened the
     drawer, so a keyboard user is not dropped at the top of the page. */
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    filterBtnRef.current?.focus();
  }, []);

  const appliedCount = countHomeworkFilters(filters);
  const isFiltered = status !== 'all' || appliedCount > 0 || filters.search.trim() !== '';
  const counts = data.counts || { all: 0, draft: 0, active: 0, pending: 0, completed: 0 };

  function changeTab(next) {
    if (next === status) return;
    setStatus(next);
    setPage(1);
    setOpenId(null);
    setDetail(null);
  }

  function applyFilters(next) {
    setFilters({ ...next, search: filters.search });
    setPage(1);
    setOpenId(null);
    setDetail(null);
    closePanel();
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    appliedSearchRef.current = '';
    setStatus('all');
    setPage(1);
    setOpenId(null);
    setDetail(null);
    setPanelOpen(false);
  }

  async function toggleProgress(item) {
    if (openId === item.assignmentId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(item.assignmentId);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const res = await api.get(`/homework/${item.assignmentId}/progress`);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to load student progress');
    } finally {
      setDetailLoading(false);
    }
  }

  function changePage(next) {
    setOpenId(null);
    setDetail(null);
    setPage(next);
  }

  /* Deleting takes the assignment, and with it every student's submission and
     attempts (the foreign keys cascade server-side). The card is dropped from
     the list here rather than by refetching, so the tab, the filters and the
     page the coach was on all stay exactly as they are. */
  async function confirmDeleteHomework() {
    const item = confirmDelete;
    if (!item || deletingId) return;
    setDeletingId(item.assignmentId);
    try {
      await api.delete(`/homework/${item.assignmentId}`);

      const remaining = data.items.filter((h) => h.assignmentId !== item.assignmentId);
      const nextCounts = { ...counts };
      nextCounts.all = Math.max(0, (nextCounts.all || 0) - 1);
      nextCounts[item.status] = Math.max(0, (nextCounts[item.status] || 0) - 1);
      const nextTotal = Math.max(0, (data.total || 0) - 1);
      setData({
        ...data,
        items: remaining,
        counts: nextCounts,
        total: nextTotal,
        totalPages: Math.max(1, Math.ceil(nextTotal / PAGE_SIZE)),
      });

      setOpenId(null);
      setDetail(null);
      setConfirmDelete(null);
      /* The DELETE only invalidates the /homework scope in the HTTP cache, but
         this row is gone from the student list, the worklist and every report
         too — so drop the whole cache rather than let another surface serve it
         for another 30 seconds. */
      clearHttpCache();
      showToast('Homework deleted.');

      /* An empty page is not a page: if this was the last card here, step back
         to the previous one and let the fetch below fill it. */
      if (remaining.length === 0 && page > 1) setPage(page - 1);
    } catch (err) {
      setConfirmDelete(null);
      showToast(err.response?.data?.message || 'Failed to delete homework');
    } finally {
      setDeletingId(null);
    }
  }

  function handleAssigned(message) {
    setAssignOpen(false);
    showToast(message || 'Assigned.');
    if (page === 1) load();
    else setPage(1);
  }

  return (
    <Page piece="♟" title="Homework" sub="Puzzle assignments and per-student progress">
      {assignOpen ? (
        <PuzzleAssignPicker
          inline
          onClose={() => setAssignOpen(false)}
          onAssigned={handleAssigned}
        />
      ) : (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p style={{ fontSize: '13px', color: 'var(--cc-text-muted)' }}>
          {counts.all} home{counts.all === 1 ? 'work' : 'works'} · 10 per page
        </p>
        <button
          onClick={() => setAssignOpen(true)}
          style={{
            height: '32px',
            padding: '0 12px',
            background: 'var(--cc-accent)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: '"Segoe UI", system-ui, sans-serif'
          }}
        >
          + Assign puzzles
        </button>
      </div>

      {/* ── status chips, search box and the filter drawer ──────────────────
          The assignment worklist's toolbar, moved onto homework: chips for the
          status axis, the live search box pushed to the right, and one chip
          that opens a right-edge sheet for everything else. ─────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeTab(t.key)}
            aria-pressed={status === t.key}
            className={`chess-chip ${status === t.key ? 'chess-chip-gold' : ''}`}
          >
            {t.label}: {counts[t.key] ?? 0}
          </button>
        ))}
        <input
          placeholder="Search homework title…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="chess-input !text-xs w-full sm:w-64 ml-auto"
        />
        {/* The count is what tells the coach the list is narrowed — a bare
            filter icon next to the results looks identical either way. */}
        <button
          type="button"
          ref={filterBtnRef}
          onClick={() => setPanelOpen(true)}
          aria-haspopup="dialog"
          className={`chess-chip ${appliedCount > 0 ? 'chess-chip-red' : ''}`}
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
          Filters{appliedCount > 0 ? ` (${appliedCount})` : ''}
        </button>
      </div>

      {panelOpen && (
        <HomeworkFilterPanel
          open
          value={filters}
          classes={classes}
          students={students}
          onApply={applyFilters}
          onClose={closePanel}
        />
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="chess-card text-center py-10">
          <p className="chess-error">{error}</p>
          <Button onClick={load} variant="secondary" size="sm" className="mt-3">Retry</Button>
        </div>
      ) : data.items.length === 0 ? (
        isFiltered ? (
          <div className="chess-card text-center py-12">
            <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">🔎</span>
            <p className="text-base font-semibold text-ivory-300">No homework found</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 text-sm font-semibold text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="chess-card text-center py-12">
            <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">📋</span>
            <p className="text-base font-semibold text-ivory-300">No homework assigned yet.</p>
            <Button onClick={() => setAssignOpen(true)} variant="primary" size="md" className="mt-4">
              Assign puzzles
            </Button>
          </div>
        )
      ) : (
        <>
          <div
            className={`space-y-3 stable-list${updating ? ' is-refreshing' : ''}`}
            aria-busy={updating}
          >
            {data.items.map((h) => {
              const expanded = openId === h.assignmentId;
              const badge = HOMEWORK_STATUS[h.status] || HOMEWORK_STATUS.draft;
              return (
                <div
                  key={h.assignmentId}
                  className={`chess-card p-4 rounded-xl border transition ${
                    h.status === 'active'
                      ? 'border-gold-500/30 bg-gold-700/10'
                      : 'border-ivory-700/50 bg-black/[0.04]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-ivory-100 flex flex-wrap items-center gap-2">
                        <span className="text-gold-400">📋</span>
                        <span className="truncate">{h.title}</span>
                        <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </h3>
                      <p className="text-sm text-ivory-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>🧩 {h.puzzleCount} puzzle{h.puzzleCount === 1 ? '' : 's'}</span>
                        <span>👥 {h.submittedCount}/{h.studentCount} submitted</span>
                        <span>⚑ {h.dueDate ? `Due ${formatDate(h.dueDate)}` : 'No due date'}</span>
                        {h.setName && <span>📚 {h.setName}</span>}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[0.65rem] text-ivory-500 shrink-0">Completion</span>
                        <div className="flex-1 h-2 rounded-full bg-ivory-700/50 overflow-hidden">
                          <div
                            className="h-full bg-green-500/80 rounded-full transition-all"
                            style={{ width: `${h.completionPct}%` }}
                          />
                        </div>
                        <span className="text-[0.6rem] text-ivory-500 shrink-0">{h.completionPct}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => toggleProgress(h)}
                        variant="secondary"
                        size="sm"
                        className="!px-3 !py-1.5 text-xs shrink-0"
                      >
                        {expanded ? 'Hide progress' : 'View progress'}
                      </Button>
                      <button
                        type="button"
                        className="hw-delete"
                        title="Delete homework"
                        aria-label={`Delete ${h.title}`}
                        disabled={deletingId === h.assignmentId}
                        onClick={() => setConfirmDelete(h)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-4 pt-4 border-t border-ivory-700/50">
                      {detailLoading ? (
                        <Spinner text="Loading student progress…" />
                      ) : detailError ? (
                        <p className="chess-error text-sm">{detailError}</p>
                      ) : detail?.students?.length ? (
                        <div className="space-y-2">
                          <p className="text-[0.65rem] text-ivory-500">
                            Select a student to see every puzzle and every move they tried.
                          </p>
                          {detail.students.map((s) => {
                            const sBadge = STUDENT_STATUS[s.status] || STUDENT_STATUS.pending;
                            return (
                              <div
                                key={s.studentId}
                                role="button"
                                tabIndex={0}
                                aria-label={`Open ${s.name}'s puzzle attempts`}
                                onClick={() => setReview({ student: s, badge: sBadge })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setReview({ student: s, badge: sBadge });
                                  }
                                }}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ivory-700/50 bg-black/[0.03] px-3 py-2 cursor-pointer transition hover:border-blue-500/60 hover:bg-blue-500/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-ivory-200 truncate">
                                    {s.name}
                                    <span className="ml-1.5 text-ivory-500" aria-hidden="true">▸</span>
                                  </p>
                                  <p className="text-[0.65rem] text-ivory-500 truncate">{s.email || ''}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-ivory-500">
                                  <span className={`px-2 py-0.5 rounded-full border ${sBadge.cls}`}>{sBadge.label}</span>
                                  <span>{s.progressCompleted}/{s.progressTotal} solved</span>
                                  <span>{s.attemptCount} tries</span>
                                  <span>{s.score ?? s.points} pts</span>
                                  {s.timeTaken > 0 && <span>{Math.round(s.timeTaken / 60)} min</span>}
                                  {s.submittedAt && <span>✔ {formatDate(s.submittedAt)}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-ivory-500">No students have been assigned this homework yet.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Pagination
            currentPage={page}
            totalPages={data.totalPages || 1}
            totalItems={data.total || 0}
            pageSize={PAGE_SIZE}
            onPageChange={changePage}
            itemLabel="homework"
            className="mt-6"
          />
        </>
      )}
      </>
      )}

      {/* The app's shared two-button dialog, so a homework deletion looks and
          behaves exactly like every other destructive confirmation. */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this homework?"
        message="This will remove it for all assigned students."
        cancelText="Cancel"
        confirmText={deletingId ? 'Deleting…' : 'Delete'}
        onCancel={() => { if (!deletingId) setConfirmDelete(null); }}
        onConfirm={confirmDeleteHomework}
      />

      {review && (
        <StudentAttemptDrawer
          submissionId={review.student.submissionId}
          student={review.student}
          badge={review.badge}
          onClose={() => setReview(null)}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-toast)] px-4 py-2.5 rounded-xl border border-gold-500/40 bg-ink-800 text-sm text-ivory-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={{ animation: 'board-pop .3s both' }}
        >
          {toast}
        </div>
      )}
    </Page>
  );
}
