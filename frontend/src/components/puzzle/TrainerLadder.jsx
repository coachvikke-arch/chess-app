import StudentAvatar from '../StudentAvatar';
import Button from '../Button';
import { scoringNote } from '../../lib/puzzleScore';

/**
 * The Puzzle Trainer's ladder.
 *
 * One component, two homes: the side column on a desktop (where it takes the
 * height the board does not need and scrolls inside itself) and the sheet a
 * phone opens from the leaderboard row. Both read the same response, so the two
 * cannot show a student different ranks.
 *
 * Every number here comes from the server: `board.top` is the ranked ten,
 * `board.me` is the viewer's own row even when it sits below them, and
 * `board.scoring` is the rule the points were awarded under.
 */
export default function TrainerLadder({ board, loading = false, error = '', myUserId, onRefresh, staff = false }) {
  const top = Array.isArray(board?.top) ? board.top : [];
  const me = board?.me || null;
  const isMe = (row) => Number(row.user_id) === Number(myUserId);
  const meInTop = !!me && top.some(isMe);
  const note = scoringNote(board?.scoring);

  return (
    <div className="pt-lb">
      <div className="pt-lb-head">
        <span className="pt-lb-title"><span aria-hidden="true">♛</span> Leaderboard</span>
        {board && <span className="pt-lb-players">{board.players} {board.players === 1 ? 'player' : 'players'}</span>}
        <button
          type="button"
          className="pt-lb-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh leaderboard"
          title="Refresh leaderboard"
        >
          <span aria-hidden="true">⟳</span>
        </button>
      </div>

      <div className="pt-lb-body">
        {error ? (
          <div className="pt-lb-state">
            <p>{error}</p>
            <Button type="button" size="sm" variant="secondary" onClick={onRefresh} loading={loading}>
              Retry
            </Button>
          </div>
        ) : !board ? (
          <div className="pt-lb-state">
            <div className="chess-spinner"><span>♞</span></div>
          </div>
        ) : top.length === 0 ? (
          <div className="pt-lb-state">
            <p>{staff ? 'No student scores yet.' : 'No scores yet. Solve a puzzle and you open the ladder.'}</p>
          </div>
        ) : (
          <ol className="pt-lb-list">
            {top.map((row) => (
              <li key={row.user_id} className={`pt-lb-row${isMe(row) ? ' is-me' : ''}`}>
                <span className={`pt-lb-rank${row.rank <= 3 ? ' is-top' : ''}`}>{row.rank}</span>
                <span className="pt-lb-av">
                  {row.profile_image ? (
                    <img src={row.profile_image} alt="" className="pt-lb-photo" />
                  ) : (
                    <StudentAvatar config={row.avatar_config} seed={`user_${row.user_id}`} size={28} />
                  )}
                </span>
                <span className="pt-lb-name">
                  <span className="pt-lb-uname">{row.name}</span>
                  {isMe(row) && <em className="pt-lb-you">You</em>}
                </span>
                <span className="pt-lb-score">
                  <b>{row.total_points}</b>
                  <small>{row.solved_count} solved</small>
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Outside the ten, the viewer still gets a row — that is the whole point
            of `me`: a student far down the ladder can see the number they moved.
            Staff have no row to show: they are not ranked at all. */}
        {board && !staff && !meInTop && (
          <div className={`pt-lb-row is-me is-outside${me ? '' : ' is-unranked'}`}>
            <span className="pt-lb-rank">{me ? me.rank : '—'}</span>
            <span className="pt-lb-av">
              {me?.profile_image ? (
                <img src={me.profile_image} alt="" className="pt-lb-photo" />
              ) : (
                <StudentAvatar config={me?.avatar_config} seed={`user_${myUserId ?? 'me'}`} size={28} />
              )}
            </span>
            <span className="pt-lb-name">
              <span className="pt-lb-uname">{me ? me.name : 'Not ranked yet'}</span>
              <em className="pt-lb-you">You</em>
            </span>
            <span className="pt-lb-score">
              <b>{me ? me.total_points : 0}</b>
              <small>{me ? `${me.solved_count} solved` : 'solve to rank'}</small>
            </span>
          </div>
        )}
      </div>

      {staff && <p className="pt-lb-rules">Student leaderboard — staff practice is not ranked.</p>}
      {note && <p className="pt-lb-rules">{note}</p>}
    </div>
  );
}