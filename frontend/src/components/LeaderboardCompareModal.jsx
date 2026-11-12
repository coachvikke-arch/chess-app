import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import Modal from './Modal';
import Button from './Button';
import StudentAvatar from './StudentAvatar';

/* ── Leaderboard compare sheet ───────────────────────────────────────────────
 *
 * Opens from a row's Compare action and shows the viewer against one classmate:
 * two identity cards, the same stat lines for both (better value in green), and
 * the head-to-head record. The server owns every number — this file only
 * formats what it is given, so the sheet can never disagree with the board.
 *
 * The opponent can be swapped from the picker at the top; the list is the
 * leaderboard that opened the sheet (already loaded by the page), so no extra
 * roster request is made.
 */

function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function streakText(player) {
  if (!player?.streak) return '—';
  const { type, count } = player.streak;
  return `${count}${type}`;
}

function pctText(value) {
  return value == null ? '—' : `${Math.round(value)}%`;
}

function ResultChip({ result, title }) {
  if (!result) return null;
  return (
    <span className={`cmp-result cmp-result--${result.toLowerCase()}`} title={title}>
      {result}
    </span>
  );
}

function PlayerHead({ player, tag }) {
  return (
    <div className={`cmp-head cmp-head--${tag}`}>
      <div className="cmp-avatar">
        {player.profile_image ? (
          <img src={player.profile_image} alt="" />
        ) : (
          <StudentAvatar
            config={player.avatar_config}
            seed={`student_${player.student_id || ''}`}
            size={62}
          />
        )}
      </div>
      <div className="cmp-head-copy">
        <span className="cmp-tag">{tag === 'me' ? 'You' : 'Opponent'}</span>
        <span className="cmp-name" title={player.name}>{player.name}</span>
        <span className="cmp-meta">
          {player.rank ? `#${player.rank} on the board` : 'Unranked'}
          {player.group_name ? ` · ${player.group_name}` : ''}
        </span>
        <span className="cmp-chips">
          <span className="cmp-chip cmp-chip--elo">
            {player.rapidRating == null ? 'No Rapid games' : `${player.rapidRating} Rapid`}
          </span>
          <span className="cmp-chip" title={`${player.badge.tier} badge`}>
            {player.badge.icon} {player.badge.name}
          </span>
          <span className="cmp-chip" title={player.level.tier}>Lv {player.level.number}</span>
        </span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="cmp-skeleton" aria-hidden="true">
      <div className="cmp-skel-row cmp-skel-head">
        <span className="cmp-skel cmp-skel-circle" />
        <span className="cmp-skel cmp-skel-line" />
        <span className="cmp-skel cmp-skel-circle" />
        <span className="cmp-skel cmp-skel-line" />
      </div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="cmp-skel-row" key={i}>
          <span className="cmp-skel cmp-skel-val" />
          <span className="cmp-skel cmp-skel-label" />
          <span className="cmp-skel cmp-skel-val" />
        </div>
      ))}
      <span className="cmp-sr">Loading comparison…</span>
    </div>
  );
}

function StatRow({ label, mine, theirs, better, barValue, mineBar, theirsBar }) {
  return (
    <div className="cmp-stat">
      <span className={`cmp-val${better === 'me' ? ' cmp-val--win' : ''}`}>
        {mine}
        {better === 'me' && <span className="cmp-sr"> (better)</span>}
      </span>
      <span className="cmp-label">
        {label}
        {barValue != null && (
          <span className="cmp-bars" aria-hidden="true">
            <span className="cmp-bar"><span style={{ width: `${mineBar}%` }} /></span>
            <span className="cmp-bar"><span style={{ width: `${theirsBar}%` }} /></span>
          </span>
        )}
      </span>
      <span className={`cmp-val${better === 'theirs' ? ' cmp-val--win' : ''}`}>
        {theirs}
        {better === 'theirs' && <span className="cmp-sr"> (better)</span>}
      </span>
    </div>
  );
}

function HeadToHead({ headToHead, opponentName }) {
  const h2h = headToHead || { total: 0, myWins: 0, opponentWins: 0, draws: 0, winRate: 0, lastGames: [] };
  if (!h2h.total) {
    return (
      <section className="cmp-section cmp-section--h2h">
        <h3 className="cmp-section-title">Head to head</h3>
        <p className="cmp-empty">Inum indha rendu perum game aadala.</p>
        <p className="cmp-empty-sub">No games between these two yet — the first one starts this record.</p>
      </section>
    );
  }
  const names = `${h2h.myWins} won by you, ${h2h.opponentWins} by ${opponentName}, ${h2h.draws} drawn`;
  return (
    <section className="cmp-section cmp-section--h2h">
      <div className="cmp-section-head">
        <h3 className="cmp-section-title">Head to head</h3>
        <span className="cmp-h2h-count">{h2h.total} game{h2h.total === 1 ? '' : 's'}</span>
      </div>
      <p className="cmp-h2h-summary">{names}</p>
      <div
        className="cmp-h2h-bar"
        role="img"
        aria-label={`Of ${h2h.total} games, ${h2h.myWins} won by you, ${h2h.opponentWins} by ${opponentName}, ${h2h.draws} drawn`}
      >
        <span className="cmp-h2h-seg cmp-h2h-seg--me" style={{ flexGrow: h2h.myWins }} />
        <span className="cmp-h2h-seg cmp-h2h-seg--draw" style={{ flexGrow: h2h.draws }} />
        <span className="cmp-h2h-seg cmp-h2h-seg--opp" style={{ flexGrow: h2h.opponentWins }} />
      </div>
      <div className="cmp-h2h-legend">
        <span><i className="cmp-dot cmp-dot--me" />You <b>{h2h.myWins}</b></span>
        <span><i className="cmp-dot cmp-dot--draw" />Draws <b>{h2h.draws}</b></span>
        <span><i className="cmp-dot cmp-dot--opp" />{opponentName} <b>{h2h.opponentWins}</b></span>
        <span className="cmp-h2h-rate">You won {Math.round(h2h.winRate)}%</span>
      </div>

      <ul className="cmp-h2h-list">
        {h2h.lastGames.map((game, i) => (
          <li key={game.id ?? `${game.date}-${i}`}>
            <ResultChip result={game.result} title={game.result === 'W' ? 'You won' : game.result === 'L' ? 'You lost' : 'Draw'} />
            <span className="cmp-h2h-date">{shortDate(game.date)}</span>
            <span className="cmp-h2h-color">
              {game.color ? `${game.color === 'white' ? 'White' : 'Black'} pieces` : 'Colour unavailable'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LeaderboardCompareModal({
  open,
  onClose,
  students = [],
  me = null,
  initialOpponentId = null,
}) {
  const selectId = useId();
  const [opponentId, setOpponentId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ticket = useRef(0);

  /* Every open starts from the row that was clicked. Swapping inside the sheet
     does not change `initialOpponentId`, so this does not undo the swap. */
  useEffect(() => {
    if (!open) return;
    setOpponentId(initialOpponentId ? Number(initialOpponentId) : null);
  }, [open, initialOpponentId]);

  const load = useCallback((id) => {
    if (!id) return undefined;
    const mine = ++ticket.current;
    setLoading(true);
    setError('');
    api.get(`/leaderboard/compare/${id}`, { cache: false })
      .then((res) => {
        if (mine !== ticket.current) return;
        setData(res.data || null);
        if (!res.data || !res.data.me || !res.data.opponent) {
          setError('The comparison came back incomplete. Please try again.');
        }
      })
      .catch((err) => {
        if (mine !== ticket.current) return;
        setData(null);
        setError(
          err.response?.data?.message
            || (err.response?.status === 403
              ? 'Comparing players is not allowed for this account.'
              : 'Could not load this comparison.'),
        );
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false);
      });
    return undefined;
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (!opponentId) {
      setData(null);
      setLoading(false);
      setError('');
      return undefined;
    }
    load(opponentId);
    return () => { ticket.current += 1; };
  }, [open, opponentId, load]);

  const options = useMemo(() => {
    const myId = Number(me?.id);
    const seen = new Set();
    const list = [];
    for (const student of students || []) {
      const id = Number(student.user_id);
      if (!id || id === myId || seen.has(id)) continue;
      seen.add(id);
      list.push(student);
    }
    /* The current pick must stay selectable even when the board that opened the
       sheet has since re-sorted it out of the list. */
    if (data?.opponent && !seen.has(Number(data.opponent.user_id))) {
      list.unshift(data.opponent);
    }
    return list;
  }, [students, me?.id, data?.opponent]);

  const mine = data?.me;
  const theirs = data?.opponent;
  const betterOf = (mineValue, theirValue, kind) => {
    if (mineValue == null || theirValue == null || mineValue === theirValue) return null;
    if (kind === 'low') return mineValue < theirValue ? 'me' : 'theirs';
    return mineValue > theirValue ? 'me' : 'theirs';
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="⚔"
      title="Compare players"
      description="Your record next to a classmate's — games, puzzles and the head-to-head."
      size="lg"
      modalClass="cmp-modal"
      layerClass="cmp-layer"
    >
      <div className="cmp-picker">
        <label className="cmp-picker-label" htmlFor={selectId}>Compare with</label>
        <select
          id={selectId}
          className="cmp-select"
          value={opponentId ?? ''}
          onChange={(e) => setOpponentId(Number(e.target.value))}
        >
          <option value="" disabled>Choose a student…</option>
          {options.map((student) => (
            <option key={student.user_id} value={student.user_id}>
              {student.rank ? `#${student.rank} · ` : ''}{student.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <Skeleton />}

      {!loading && error && (
        <div className="cmp-error" role="alert">
          <p>{error}</p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="!py-2 !px-4"
            onClick={() => load(opponentId)}
          >
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && !opponentId && (
        <p className="cmp-empty">Pick a student above to see the comparison.</p>
      )}

      {!loading && !error && mine && theirs && (
        <>
          <div className="cmp-heads">
            <PlayerHead player={mine} tag="me" />
            <span className="cmp-vs" aria-hidden="true">VS</span>
            <PlayerHead player={theirs} tag="opponent" />
          </div>

          <div className="cmp-stats">
            <StatRow
              label="Games played"
              mine={mine.games}
              theirs={theirs.games}
              better={betterOf(mine.games, theirs.games)}
            />
            <StatRow
              label="Wins"
              mine={mine.wins}
              theirs={theirs.wins}
              better={betterOf(mine.wins, theirs.wins)}
            />
            <StatRow
              label="Losses"
              mine={mine.losses}
              theirs={theirs.losses}
              better={betterOf(mine.losses, theirs.losses, 'low')}
            />
            <StatRow
              label="Draws"
              mine={mine.draws}
              theirs={theirs.draws}
            />
            <StatRow
              label="Win rate"
              mine={pctText(mine.winRate)}
              theirs={pctText(theirs.winRate)}
              better={betterOf(mine.winRate, theirs.winRate)}
              barValue
              mineBar={Math.max(0, Math.min(100, mine.winRate || 0))}
              theirsBar={Math.max(0, Math.min(100, theirs.winRate || 0))}
            />
            <div className="cmp-stat">
              <span className={`cmp-val cmp-streak${mine.streak?.type === 'W' ? ' cmp-streak--w' : mine.streak ? ' cmp-streak--l' : ''}`}>
                {streakText(mine)}
              </span>
              <span className="cmp-label">Current streak</span>
              <span className={`cmp-val cmp-streak${theirs.streak?.type === 'W' ? ' cmp-streak--w' : theirs.streak ? ' cmp-streak--l' : ''}`}>
                {streakText(theirs)}
              </span>
            </div>
            <StatRow
              label="Puzzles solved"
              mine={mine.puzzlesSolved}
              theirs={theirs.puzzlesSolved}
              better={betterOf(mine.puzzlesSolved, theirs.puzzlesSolved)}
            />
            <StatRow
              label="Puzzle rating"
              mine={mine.puzzlePoints}
              theirs={theirs.puzzlePoints}
              better={betterOf(mine.puzzlePoints, theirs.puzzlePoints)}
            />
            <StatRow
              label="Accuracy"
              mine={pctText(mine.accuracy)}
              theirs={pctText(theirs.accuracy)}
              better={betterOf(mine.accuracy, theirs.accuracy)}
            />
            <div className="cmp-stat cmp-stat--form">
              <span className="cmp-val cmp-form">
                {mine.lastGames.length === 0
                  ? <span className="cmp-muted">No games yet</span>
                  : mine.lastGames.map((game, i) => (
                    <ResultChip
                      key={game.id ?? `m-${i}`}
                      result={game.result}
                      title={`${shortDate(game.date)}${game.color ? ` · ${game.color} pieces` : ''}`}
                    />
                  ))}
              </span>
              <span className="cmp-label">Last 5 games</span>
              <span className="cmp-val cmp-form">
                {theirs.lastGames.length === 0
                  ? <span className="cmp-muted">No games yet</span>
                  : theirs.lastGames.map((game, i) => (
                    <ResultChip
                      key={game.id ?? `t-${i}`}
                      result={game.result}
                      title={`${shortDate(game.date)}${game.color ? ` · ${game.color} pieces` : ''}`}
                    />
                  ))}
              </span>
            </div>
          </div>

          <HeadToHead headToHead={data.headToHead} opponentName={theirs.name} />
        </>
      )}
    </Modal>
  );
}
