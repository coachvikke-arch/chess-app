import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Pagination from '../components/Pagination';
import Button from '../components/Button';

const PAGE_SIZE = 10;

const STUDENT_STATUS = {
  pending: { label: 'Pending', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  in_progress: { label: 'In Progress', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  submitted: { label: 'Submitted', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  overdue: { label: 'Overdue', cls: 'bg-red-500/10 border-red-500/30 text-red-600' },
};

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

/**
 * Admin Homework — every puzzle assignment made from Puzzle Listing, with a
 * submitted/total count. Opening one fetches per-student progress from
 * GET /api/homework/:id/progress (the same tracker the coach already uses).
 */
export default function AdminHomework() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null); // { students: [...] }
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/homework', { params: { page, limit: PAGE_SIZE } });
      const next = res.data || {};
      setData(next);
      if (page > (next.totalPages || 1)) setPage(next.totalPages || 1);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load homework');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <Page piece="♟" title="Homework" sub="Puzzle assignments and per-student progress">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs text-ivory-500">
          {data.total} home{data.total === 1 ? 'work' : 'works'} assigned · 10 per page
        </p>
        <Button onClick={() => navigate('/admin/puzzle-listing')} variant="primary" size="sm" className="!px-3 !py-1.5 text-xs">
          + Assign puzzles
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="chess-card text-center py-10">
          <p className="chess-error">{error}</p>
          <Button onClick={load} variant="secondary" size="sm" className="mt-3">Retry</Button>
        </div>
      ) : data.items.length === 0 ? (
        <div className="chess-card text-center py-12">
          <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">📋</span>
          <p className="chess-empty">No homework assigned yet.</p>
          <Button onClick={() => navigate('/admin/puzzle-listing')} variant="primary" size="md" className="mt-4">
            Assign puzzles
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((h) => {
              const expanded = openId === h.assignmentId;
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
                        <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${
                          h.status === 'active'
                            ? 'bg-gold-500/10 border-gold-500/30 text-gold-500'
                            : h.status === 'draft'
                              ? 'bg-black/5 border-ivory-700/50 text-ivory-500'
                              : 'bg-black/5 border-ivory-700/50 text-ivory-400'
                        }`}>
                          {h.status === 'active' ? 'Active' : h.status === 'draft' ? 'Draft' : 'Archived'}
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
                            const badge = STUDENT_STATUS[s.status] || STUDENT_STATUS.pending;
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
                                  <span className={`px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
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
    </Page>
  );
}
