import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLiveClass } from '../../context/LiveClassContext';
import { getClassLeaderboard } from '../../services/liveClassApi';
import { on } from '../../services/socket';
import StudentAvatar from '../StudentAvatar';

/* Safety-net refresh. The socket events below make this feel instant; this only
   matters if a socket drops (the classroom already warns about that) so the
   board does not stay frozen at whatever it last managed to fetch. */
const POLL_MS = 20000;

function num(v) {
  const n = Number(v) || 0;
  return n;
}

/* The board is scored from assigned drills only, so these four states are the
   whole story. Keyed by the server's `status`; the server decides, the client
   only finds the words and a colour. */
const STATUS = {
  completed: { label: 'Completed', cls: 'lb-st-done', i: '✅' },
  in_progress: { label: 'In progress', cls: 'lb-st-wip', i: '✏️' },
  joined: { label: 'Joined', cls: 'lb-st-joined', i: '👋' },
  not_joined: { label: 'Not joined', cls: 'lb-st-away', i: '⭕' },
};

function statusOf(row) {
  return STATUS[row?.status] || STATUS.not_joined;
}

/**
 * Classroom leaderboard — the same podium + table UI as the main leaderboard,
 * scored from the drills assigned in this class.
 *
 * Scoring is drill points only: the value the coach set on each drill, taken
 * from live_class_puzzle_progress. Online games and bot games are deliberately
 * not counted, so the board cannot be topped by grinding bots outside the
 * lesson and it reports the one number the coach actually assigned.
 *
 * Everyone enrolled is listed, not just the students who scored. A board showing
 * only the top three tells the coach nothing about the students who have not
 * opened the drill yet, so each row carries a status as well as a score.
 *
 * Everyone in the room can see it — the students are who it is meant to
 * motivate — so this deliberately does not re-check permissions the way the
 * admin-only class endpoints do.
 */
export default function ClassroomLeaderboard({ asMobilePanel = false }) {
  const { user } = useAuth();
  const { classMeta } = useLiveClass();
  const classId = classMeta?.id;

  const [rows, setRows] = useState([]);
  const [drillsAssigned, setDrillsAssigned] = useState(0);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (classId == null) return;
    try {
      const data = await getClassLeaderboard(classId);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setDrillsAssigned(Number(data?.drillsAssigned) || 0);
      setError('');
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          (err?.response?.status === 403
            ? 'You are not in this class, so the leaderboard is unavailable.'
            : 'Could not load the class leaderboard.'),
      );
    } finally {
      setLoaded(true);
    }
  }, [classId]);

  useEffect(() => {
    if (classId == null) return undefined;
    setRows([]);
    setLoaded(false);
    refresh();
  }, [classId, refresh]);

  /* Socket-driven refresh: this is the exact event that awards drill points, so
     a student sees their own score move the moment they finish rather than
     waiting for the poll. The payload carries classId.

     Refresh immediately rather than resetting a timer: bumping state here would
     only restart the poll interval, so the "instant" update would still be up to
     POLL_MS late. */
  useEffect(() => {
    if (classId == null) return undefined;
    const off = on('puzzle_drill_progress', (payload) => {
      if (payload && payload.classId != null && Number(payload.classId) !== Number(classId)) return;
      refresh();
    });
    return () => off();
  }, [classId, refresh]);

  useEffect(() => {
    if (classId == null) return undefined;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [classId, refresh]);

  if (classId == null) return null;

  return (
    <div className={`lb-classroom ${asMobilePanel ? 'lb-classroom-mobile' : ''}`}>
      <div className="lb-classroom-head">
        <span className="lb-classroom-title">🏆 Class leaderboard</span>
        <button
          type="button"
          className="live-chip"
          onClick={refresh}
          title="Refresh the leaderboard"
          aria-label="Refresh the leaderboard"
        >
          ⟳
        </button>
      </div>

      <p className="lb-classroom-sub">
        Assigned drill points from this class only
        {drillsAssigned > 0 ? ` — ${drillsAssigned} drill${drillsAssigned === 1 ? '' : 's'} assigned.` : '.'}{' '}
        Every student on the roster is listed, so you can see who still needs to start.
      </p>

      {error && <p className="live-chat-error">{error}</p>}

      {!loaded && <p className="lb-classroom-empty">Loading the leaderboard…</p>}

      {loaded && !error && rows.length === 0 && (
        <p className="lb-classroom-empty">
          No students are enrolled in this class yet, so there is nothing to rank.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="lb-grid lb-grid--class lb-head">
            <span>Rank</span>
            <span>Player</span>
            <span className="lb-c-status">Status</span>
            <span className="lb-c-puz">Drills</span>
            <span className="lb-c-pts">Points</span>
          </div>
          <div className="lb-body">
            {rows.map((r) => {
                  const st = statusOf(r);
                  return (
                    <div
                      key={r.user_id}
                      className={`lb-grid lb-grid--class lb-row ${Number(r.user_id) === Number(user?.id) ? 'lb-row--me' : ''}`}
                    >
                      <span className={`lb-rank ${r.rank <= 4 ? 'top' : ''}`}>#{r.rank}</span>
                      <span className="lb-player">
                        {r.profile_image ? (
                          <img src={r.profile_image} alt="" className="lb-photo rounded-full object-cover" />
                        ) : (
                          <StudentAvatar config={r.avatar_config} seed={`student_${r.student_id || ''}`} size={26} />
                        )}
                        <span className="lb-player-name">{r.name}</span>
                        {Number(r.user_id) === Number(user?.id) && <span className="lb-you">you</span>}
                      </span>
                      <span className={`lb-status ${st.cls}`} title={st.label}>
                        <span aria-hidden="true">{st.i}</span> {st.label}
                      </span>
                      <span className="lb-c-puz">
                        {num(r.puzzles_solved)}/{num(r.drills_assigned)}
                        {/* "attempted" is 9 characters and the column is 52px; at
                            10px it overflowed into the Points column instead of
                            ellipsising. "tried" says the same thing in half the
                            width, and the count is unchanged. */}
                        <span className="lb-sub">
                          {num(r.puzzles_attempted) > 0
                            ? `${num(r.puzzles_attempted)} tried`
                            : 'none'}
                        </span>
                      </span>
                      <span className="lb-elo2 lb-c-pts">♙ {num(r.total_points)}</span>
                    </div>
                  );
                })}
          </div>
        </>
      )}
    </div>
  );
}