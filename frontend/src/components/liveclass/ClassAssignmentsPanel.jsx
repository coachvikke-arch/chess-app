import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { Spinner, Bar } from '../ui';
import PuzzleReviewModal from '../PuzzleReviewModal';
import { StatusPill, fmtDate } from '../PuzzleAssignmentsPanel';
import { useLiveClass } from '../../context/LiveClassContext';
import { buildSummaries, filterSummaries } from '../../utils/classAssignments';
import Button from '../Button';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
];

/* The date a student finished the work: reviewed beats submitted, and a missing
   pair reads as "not finished yet". */
function finishedAt(row) {
  return row?.reviewedAt || row?.submittedAt || null;
}

/**
 * Classroom "Assignments" tab — who in this class has done the puzzle
 * assignments, reusing the Worklist's data source and status UI.
 *
 * Screen 1 lists the enrolled students with their assignment/puzzle counts;
 * screen 2 (on click) reuses the Worklist tracker endpoint for that one student
 * so every status, score and date is literally the Worklist's.
 *
 * Instructor-only by construction: ChatPanel only renders the chip for coaches,
 * and every endpoint used here is admin-gated on the server.
 */
export default function ClassAssignmentsPanel({ active = false, asMobilePanel = false }) {
  const { classMeta } = useLiveClass();
  const classId = classMeta?.id;

  const [roster, setRoster] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [reviewId, setReviewId] = useState(null);

  const refresh = useCallback(async () => {
    if (classId == null) return;
    setLoading(true);
    setError('');
    try {
      const [detailRes, listRes] = await Promise.all([
        api.get(`/classes/${classId}/detail`),
        api.get('/assignments/puzzle-assignments'),
      ]);
      setRoster(Array.isArray(detailRes.data?.students) ? detailRes.data.students : []);
      setAssignments(Array.isArray(listRes.data) ? listRes.data : []);
    } catch (e) {
      setError(e?.response?.data?.message || 'Could not load this class’s assignments.');
      setRoster([]);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  /* Fetch on first open and again every time the tab is reopened, so the list is
     never a stale snapshot from the last time the coach looked. */
  useEffect(() => {
    if (!active) return;
    refresh();
  }, [active, refresh]);

  const rows = useMemo(() => buildSummaries(roster, assignments), [roster, assignments]);
  const visible = useMemo(() => filterSummaries(rows, filter, search), [rows, filter, search]);

  const openStudent = useCallback(async (summary) => {
    setSelected(summary);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      /* Only the assignments this student is actually on, fetched from the very
         endpoint the Worklist tracker uses. */
      const mine = assignments.filter((a) =>
        (a?.student_refs || []).some((r) => Number(r?.id) === Number(summary.id))
      );
      const results = await Promise.all(
        mine.map((a) =>
          api
            .get(`/assignments/puzzle-assignments/${a.id}/students`)
            .then((r) => ({
              assignment: a,
              row: (r.data?.students || []).find((s) => Number(s.studentId) === Number(summary.id)) || null,
            }))
            .catch(() => ({ assignment: a, row: null }))
        )
      );
      setDetail(results.filter((x) => x.row));
    } catch (e) {
      setDetailError(e?.response?.data?.message || 'Could not load this student’s work.');
    } finally {
      setDetailLoading(false);
    }
  }, [assignments]);

  const back = () => {
    setSelected(null);
    setDetail(null);
    setDetailError('');
  };

  if (classId == null) return null;

  return (
    <div className={`live-assign ${asMobilePanel ? 'live-assign--mobile' : ''}`}>
      {selected ? (
        <>
          <div className="live-assign-head">
            <button type="button" className="live-chip" onClick={back} title="Back to the student list">
              ← Back
            </button>
            <span className="live-assign-name" title={selected.name}>{selected.name}</span>
          </div>

          <p className="live-assign-sub">
            {selected.assignmentsDone}/{selected.assignmentsTotal} assignments ·{' '}
            {selected.puzzlesDone}/{selected.puzzlesTotal} puzzles — the same statuses the Worklist shows.
          </p>

          {detailError && <p className="live-chat-error">{detailError}</p>}
          {detailLoading && <Spinner text="Loading this student’s work…" />}

          {!detailLoading && !detailError && detail && detail.length === 0 && (
            <p className="live-assign-empty">No puzzle assignments have been given to this student yet.</p>
          )}

          {!detailLoading && detail && detail.length > 0 && (
            <ul className="live-assign-detail">
              {detail.map(({ assignment, row }) => (
                <li key={assignment.id} className="live-assign-detail-row">
                  <div className="live-assign-detail-top">
                    <span className="live-assign-detail-title">
                      <span className="text-gold-400">♞</span> {assignment.title}
                    </span>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="live-assign-detail-meta">
                    <span className="live-assign-detail-progress">
                      <span className="live-assign-detail-count">
                        {row.progressCompleted}/{row.progressTotal} puzzles
                      </span>
                      <span className="live-assign-detail-bar"><Bar pct={row.progressPct} /></span>
                    </span>
                    <span>{row.attemptCount} attempt{row.attemptCount === 1 ? '' : 's'}</span>
                    <span>⚑ {fmtDate(finishedAt(row))}</span>
                    <Button
                      type="button"
                      variant="secondary" size="sm" className="!px-3 !py-1 text-xs ml-auto"
                      onClick={() => setReviewId(row.submissionId)}
                    >
                      Review
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="live-assign-head">
            <span className="live-assign-name">📋 Assignments</span>
            <button
              type="button"
              className="live-chip"
              onClick={refresh}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh assignments"
            >
              ⟳
            </button>
          </div>

          <div className="live-assign-controls">
            <input
              className="chess-input !text-xs live-assign-search"
              placeholder="Search student…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="live-assign-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`chess-chip text-[0.65rem] ${filter === f.value ? 'chess-chip-gold' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="live-assign-empty">
              <p className="live-chat-error">{error}</p>
              <Button type="button" variant="secondary" size="sm" className="!px-4 !py-1.5 text-xs mt-2" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}

          {!error && loading && <Spinner text="Loading students…" />}

          {!error && !loading && rows.length === 0 && (
            <p className="live-assign-empty">No students are enrolled in this class yet.</p>
          )}

          {!error && !loading && rows.length > 0 && visible.length === 0 && (
            <p className="live-assign-empty">No student matches this search or filter.</p>
          )}

          {!error && !loading && visible.length > 0 && (
            <ul className="live-assign-list">
              {visible.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="live-assign-row"
                    onClick={() => openStudent(r)}
                    title={`View ${r.name}’s work`}
                  >
                    <span className="live-assign-row-top">
                      <span className="live-assign-row-name">{r.name}</span>
                      {r.assignmentsTotal === 0
                        ? <span className="live-assign-row-none">no assignments</span>
                        : <span className="live-assign-row-counts">
                            {r.assignmentsDone}/{r.assignmentsTotal} assignments ·{' '}
                            {r.puzzlesDone}/{r.puzzlesTotal} puzzles
                          </span>}
                    </span>
                    <span className="live-assign-row-bar"><Bar pct={r.pct} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {reviewId && (
        <PuzzleReviewModal submissionId={reviewId} onClose={() => setReviewId(null)} />
      )}
    </div>
  );
}
