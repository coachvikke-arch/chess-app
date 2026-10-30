import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Pagination from '../components/Pagination';
import Button from '../components/Button';
import PuzzleAssignPicker from '../components/PuzzleAssignPicker';
import HomeworkFilterPanel, {
  HOMEWORK_FILTER_DEFAULTS,
  countHomeworkFilters,
} from '../components/HomeworkFilterPanel';

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
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState({ items: [], counts: null, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [panelOpen, setPanelOpen] = useState(false);
  /* The search box lives in the toolbar, not the drawer — like the worklist it
     narrows the list as you type, so the typed value is kept apart from the
     debounced one that goes into the query. */
  const [searchInput, setSearchInput] = useState('');
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

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: PAGE_SIZE };
      if (status !== 'all') params.status = status;
      for (const [key, value] of Object.entries(filters)) {
        if (String(value).trim() !== '') params[key] = String(value).trim();
      }
      const res = await api.get('/homework', { params });
      const next = res.data || {};
      setData(next);
      if (page > (next.totalPages || 1)) setPage(next.totalPages || 1);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load homework');
    } finally {
      setLoading(false);
    }
  }, [page, status, filters]);

  useEffect(() => { load(); }, [load]);

  /* Filter options come from the same endpoints the rest of the admin screens
     use: classes are `groups`, students are the roster. */
  useEffect(() => {
    api.get('/groups').then((res) => setClasses(res.data || [])).catch(() => {});
    api.get('/students').then((res) => setStudents(res.data || [])).catch(() => {});
  }, []);

  /* The toolbar search box is debounced before it reaches the query: the list is
     narrowed by the server, so a typed word must not fire one request per
     keystroke. */
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
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
          <div className="space-y-3">
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
                    <Button
                      onClick={() => toggleProgress(h)}
                      variant="secondary"
                      size="sm"
                      className="!px-3 !py-1.5 text-xs shrink-0"
                    >
                      {expanded ? 'Hide progress' : 'View progress'}
                    </Button>
                  </div>

                  {expanded && (
                    <div className="mt-4 pt-4 border-t border-ivory-700/50">
                      {detailLoading ? (
                        <Spinner text="Loading student progress…" />
                      ) : detailError ? (
                        <p className="chess-error text-sm">{detailError}</p>
                      ) : detail?.students?.length ? (
                        <div className="space-y-2">
                          {detail.students.map((s) => {
                            const sBadge = STUDENT_STATUS[s.status] || STUDENT_STATUS.pending;
                            return (
                              <div
                                key={s.studentId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ivory-700/50 bg-black/[0.03] px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-ivory-200 truncate">{s.name}</p>
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

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-modal-backdrop)] px-4 py-2.5 rounded-xl border border-gold-500/40 bg-ink-800 text-sm text-ivory-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={{ animation: 'board-pop .3s both' }}
        >
          {toast}
        </div>
      )}
    </Page>
  );
}
