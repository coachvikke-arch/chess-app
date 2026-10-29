import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Pagination from '../components/Pagination';
import Button from '../components/Button';
import PuzzleAssignPicker from '../components/PuzzleAssignPicker';
import PuzzleAssignmentsPanel from '../components/PuzzleAssignmentsPanel';

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

const EMPTY_FILTERS = { classId: '', studentId: '', dueFrom: '', dueTo: '', search: '' };

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function countApplied(filters) {
  return Object.values(filters).filter((v) => String(v).trim() !== '').length;
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
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);

  const [assignOpen, setAssignOpen] = useState(false);
  /* The former standalone Worklist section now lives here as a second view, so
     every assignment tool sits in one Homework section. */
  const [view, setView] = useState('homework');
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

  /* Close the filter panel on Escape (the mobile sheet has no visible backdrop
     on desktop, where it is a dropdown). */
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPanelOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const appliedCount = countApplied(filters);
  const isFiltered = status !== 'all' || appliedCount > 0;
  const counts = data.counts || { all: 0, draft: 0, active: 0, pending: 0, completed: 0 };

  function changeTab(next) {
    if (next === status) return;
    setStatus(next);
    setPage(1);
    setOpenId(null);
    setDetail(null);
  }

  function openPanel() {
    setDraft(filters);
    setPanelOpen(true);
  }

  function applyFilters() {
    setFilters({ ...draft });
    setPage(1);
    setOpenId(null);
    setDetail(null);
    setPanelOpen(false);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
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

  const filterSummary = useMemo(() => {
    if (!appliedCount) return '';
    return `${appliedCount} filter${appliedCount === 1 ? '' : 's'} applied`;
  }, [appliedCount]);

  return (
    <Page piece="♟" title="Homework" sub="Puzzle assignments and per-student progress">
      <div className="hw-viewswitch mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setView('homework')}
          className={`kt-tab shrink-0 ${view === 'homework' ? 'active' : ''}`}
          aria-pressed={view === 'homework'}
        >
          📋 Homework
        </button>
        <button
          type="button"
          onClick={() => setView('worklist')}
          className={`kt-tab shrink-0 ${view === 'worklist' ? 'active' : ''}`}
          aria-pressed={view === 'worklist'}
        >
          ♟ Worklist
        </button>
      </div>

      {view === 'worklist' ? (
        <PuzzleAssignmentsPanel />
      ) : assignOpen ? (
        <PuzzleAssignPicker
          inline
          onClose={() => setAssignOpen(false)}
          onAssigned={handleAssigned}
        />
      ) : (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-xs text-ivory-500">
          {counts.all} home{counts.all === 1 ? 'work' : 'works'} · 10 per page
          {filterSummary && <span className="ml-2 text-blue-600 font-semibold">{filterSummary}</span>}
        </p>
        <Button onClick={() => setAssignOpen(true)} variant="primary" size="sm" className="!px-3 !py-1.5 text-xs">
          + Assign puzzles
        </Button>
      </div>

      {/* ── status tabs + filters ─────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2">
        <div className="hw-tabs flex-1 min-w-0 flex items-center gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => changeTab(t.key)}
              className={`kt-tab shrink-0 flex items-center gap-1.5 ${status === t.key ? 'active' : ''}`}
              aria-pressed={status === t.key}
            >
              {t.label}
              <span className={`hw-tab-count ${status === t.key ? 'is-active' : ''}`}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="relative shrink-0">
          <Button
            type="button"
            variant={appliedCount ? 'primary' : 'secondary'}
            size="sm"
            className="!px-3 !py-1.5 text-xs whitespace-nowrap"
            onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}
            aria-expanded={panelOpen}
            aria-haspopup="dialog"
          >
            <span aria-hidden="true">⛃</span> Filters
            {appliedCount > 0 && (
              <span className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-white/25 px-1 text-[0.6rem] font-bold">
                {appliedCount}
              </span>
            )}
          </Button>

          {panelOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/40 sm:hidden"
                onClick={() => setPanelOpen(false)}
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-label="Filter homework"
                className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem] sm:rounded-xl sm:border sm:shadow-[0_18px_44px_rgba(15,23,42,0.16)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-800">Filter homework</h3>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                    aria-label="Close filters"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500 mb-1">Homework title</span>
                    <input
                      value={draft.search}
                      onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
                      placeholder="Search title…"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500 mb-1">Class</span>
                    <select
                      value={draft.classId}
                      onChange={(e) => setDraft((d) => ({ ...d, classId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
                    >
                      <option value="">All classes</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500 mb-1">Student</span>
                    <select
                      value={draft.studentId}
                      onChange={(e) => setDraft((d) => ({ ...d, studentId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
                    >
                      <option value="">All students</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500 mb-1">Due from</span>
                    <input
                      type="date"
                      value={draft.dueFrom}
                      onChange={(e) => setDraft((d) => ({ ...d, dueFrom: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500 mb-1">Due to</span>
                    <input
                      type="date"
                      value={draft.dueTo}
                      onChange={(e) => setDraft((d) => ({ ...d, dueTo: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
                    />
                  </label>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={clearFilters}>
                    Clear
                  </Button>
                  <Button type="button" variant="primary" size="sm" className="flex-1" onClick={applyFilters}>
                    Apply
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
