import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Pagination from '../components/Pagination';
import Button from '../components/Button';

const PAGE_SIZE = 10;

const STATUS = {
  pending: { label: 'Pending', cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' },
  in_progress: { label: 'In Progress', cls: 'bg-gold-500/10 border-gold-500/30 text-gold-500' },
  submitted: { label: 'Submitted', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-500/10 border-green-500/30 text-green-600' },
  overdue: { label: 'Overdue', cls: 'bg-red-500/10 border-red-500/30 text-red-600' },
};

/**
 * Student Homework — the surfacing layer over the existing puzzle-assignment
 * model. Cards come from GET /api/student/homework (10 per page); opening one
 * routes into the same solver the Puzzles page uses, scoped to that assignment.
 */
export default function StudentHomework() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/student/homework', { params: { page, limit: PAGE_SIZE } });
      const next = res.data || {};
      setData(next);
      /* A smaller result set can leave the current page out of range (a card
         disappeared, a filter narrowed). Land on the last real page. */
      if (page > (next.totalPages || 1)) setPage(next.totalPages || 1);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load homework');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  return (
    <Page piece="♟" title="Homework" sub="Puzzle homework assigned by your coach">
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
          <p className="chess-empty">No homework yet. Your coach has not assigned any puzzles.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((h) => {
              const badge = STATUS[h.status] || STATUS.pending;
              const locked = h.status === 'submitted' || h.status === 'reviewed';
              const action = locked ? 'View' : h.attempted > 0 ? 'Continue' : 'Start';
              return (
                <button
                  key={h.assignmentId}
                  type="button"
                  onClick={() => navigate(`/student/homework/${h.assignmentId}`)}
                  className={`chess-card w-full text-left p-4 rounded-xl border transition hover:-translate-y-0.5 ${
                    locked
                      ? 'border-green-500/40 bg-green-500/10'
                      : h.status === 'overdue'
                        ? 'border-red-500/30 bg-red-500/[0.04]'
                        : h.status === 'in_progress'
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
                      {h.description && (
                        <p className="text-xs text-ivory-500 mt-1 line-clamp-2">{h.description}</p>
                      )}
                      <p className="text-sm text-ivory-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>🧩 {h.puzzleCount} puzzle{h.puzzleCount === 1 ? '' : 's'}</span>
                        <span>⚑ {h.dueDate ? `Due ${new Date(h.dueDate).toLocaleDateString()}` : 'No due date'}</span>
                        {locked && (
                          <span>🏁 Score {h.score ?? 0}/{h.maxScore}</span>
                        )}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[0.65rem] text-ivory-500 shrink-0">
                          {h.solved}/{h.puzzleCount} solved
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-ivory-700/50 overflow-hidden">
                          <div
                            className="h-full bg-gold-500 rounded-full transition-all"
                            style={{ width: `${h.progress?.pct || 0}%` }}
                          />
                        </div>
                        <span className="text-[0.6rem] text-ivory-500 shrink-0">{h.progress?.pct || 0}%</span>
                      </div>
                    </div>
                    <span className="text-xs chess-link shrink-0">{action} →</span>
                  </div>
                </button>
              );
            })}
          </div>

          <Pagination
            currentPage={page}
            totalPages={data.totalPages || 1}
            totalItems={data.total || 0}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="homework"
            className="mt-6"
          />
        </>
      )}
    </Page>
  );
}
