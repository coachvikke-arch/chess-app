import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import ChessBoard from '../components/ChessBoard';
import { SIGMA_TYPE_META, SIGMA_VERDICT } from '../utils/sigmaType';
import { sigmaCardBoard, destinationBadge, plyToMoveIndex } from '../utils/sigmaDisplay';
import { Spinner } from '../components/ui';
import Button from './Button';

/* ── Σ Sigma Moves — a tab inside Game Review ───────────────────────────────
   Every brilliant move the engine has found, across every game and every
   source, listed with the kind of sacrifice it was.

   This deliberately does NOT reuse the GM Game Replay component. That screen
   exists to walk through imported grandmaster games one at a time; this one is
   the opposite — a filtered, paginated index of moments drawn from the viewer's
   OWN games across four different tables. Sharing the replay surface would drag
   in its single-game navigation and its own eval graph, neither of which fits.

   ORIENTATION
   Each card is drawn from the perspective of the player who made the move, so
   the sacrifice is on the side you played. A card whose FEN is missing cannot be
   drawn at all, and renders an explicit placeholder rather than a blank square —
   a silently empty board reads as "there was nothing here". */

const RANGES = [
  { key: 'd7', label: '7D' },
  { key: 'd30', label: '30D' },
  { key: 'd90', label: '90D' },
  { key: 'y1', label: '1Y' },
  { key: 'all', label: 'All' },
];

const DEFAULT_RANGE = 'd90';
const PAGE_SIZE = 12;

/** Remembered per user, so the screen opens the way you left it. */
const PREFS_KEY = (userId) => `sigma-prefs-v1:${userId}`;

function readPrefs(userId) {
  try {
    const raw = localStorage.getItem(PREFS_KEY(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePrefs(userId, prefs) {
  try {
    localStorage.setItem(PREFS_KEY(userId), JSON.stringify(prefs));
  } catch {
    /* storage unavailable — preferences are best-effort */
  }
}

/** "2026-01-05" or an ISO string → a short readable date, or '' when unknown. */
function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Which side the board is drawn from.
 *
 * `ownerColor` is resolved server-side per source, because the four game tables
 * record it under four different column names. It describes whoever PLAYED the
 * move, which is not always the person looking: a coach viewing a student sees
 * the student's side, and drawing it from the coach's would show the sacrifice
 * on the wrong side of the board.
 *
 * Falls back to white, which is wrong only for a Black game the engine could not
 * attribute — and a Black game is far better than no card at all.
 */
function playedColor(move) {
  return move.ownerColor === 'black' ? 'black' : 'white';
}

/**
 * @param {object} props
 * @param {object} props.user       the signed-in user
 * @param {number} [props.userId]   whose list to show (coaches pass a student id)
 * @param {boolean} [props.canPickUser] render the user picker (staff only)
 * @param {(move, nav) => void} props.onOpenGame  called with the stored sigma
 *   row and `{ moveIndex }` — the move count that leaves the board ON that move,
 *   already played. The conversion lives here (see plyToMoveIndex) so no caller
 *   can reach for the move number and land on the wrong ply.
 */
export default function SigmaMoves({ user, userId, canPickUser = false, onOpenGame }) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [type, setType] = useState(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /* Filters are restored once, on mount, from localStorage. */
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const prefs = readPrefs(user.id);
    if (RANGES.some((r) => r.key === prefs.range)) setRange(prefs.range);
    if (typeof prefs.type === 'string') setType(prefs.type);
    setRestored(true);
  }, [user.id]);

  useEffect(() => {
    if (!restored) return;
    writePrefs(user.id, { range, type });
  }, [user.id, range, type, restored]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ range, page: String(page), pageSize: String(PAGE_SIZE) });
      if (type) params.set('type', type);
      /* Only sent when it actually differs — sending the signed-in user's own id
         would be harmless but makes the request harder to read in the log. */
      if (userId && userId !== user.id) params.set('userId', String(userId));
      const res = await api.get(`/sigma/moves?${params.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not load your Brilliant moves');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, type, page, userId, user.id]);

  useEffect(() => { load(); }, [load]);

  /* Changing a filter must land back on page 1 — staying on page 7 of a
     now-shorter list shows an empty grid with no obvious cause. */
  const changeRange = (next) => { setRange(next); setPage(1); };
  const changeType = (next) => { setType(next); setPage(1); };

  const typeCounts = data?.typeCounts || {};
  const allMoves = data?.moves || [];
  /* The server already narrows the list to the owner's OWN moves — it resolves
     which colour the owner played per source and keeps only that side (a
     review can file an opponent's brilliant under the owner, and a coach game
     has two players). Nothing is filtered here: filtering a single server PAGE
     by colour/parity dropped every Black-side brilliant outside the first
     page's colour mix and made the totals, chips and pager disagree with the
     cards actually drawn. */
  const moves = allMoves;
  const total = data?.total || 0;
  const pageCount = data?.pageCount || 1;
  const showingOther = data && data.ownerUserId !== user.id;

  /* The player-facing name for this tier is "Brilliant" — 'sigma' is the internal
     id and never reaches the screen. */
  const emptyMessage = useMemo(() => {
    if (type) return 'No Brilliant moves of that type in this window. Try a wider date range.';
    if (range !== 'all') return 'No Brilliant moves in this window yet. Analyse a game, or widen the range.';
    return 'No Brilliant moves yet. They are found when a game is analysed in the Analyse tab.';
  }, [type, range]);

  /* Adjust page if current page exceeds the server's page count. */
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount]);

  return (
    <div className="gr-sigma-screen">
      {/* ── filters ── */}
      <div className="gr-sigma-bar">
        <div className="gr-sigma-ranges" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => changeRange(r.key)}
              aria-pressed={range === r.key}
              className={`gr-sigma-range${range === r.key ? ' active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {canPickUser && userId && userId !== user.id && (
          <span className="gr-sigma-owner">Showing {data?.ownerName || 'this player'}</span>
        )}
      </div>

      {/* type chips — counts come from the date-filtered set, so selecting one
          does not empty the others */}
      <div className="gr-sigma-filters">
        <button
          type="button"
          onClick={() => changeType(null)}
          aria-pressed={type === null}
          className={`gr-sigma-filter${type === null ? ' active' : ''}`}
        >
          All <span className="gr-sigma-filter-n">{total}</span>
        </button>
        {Object.entries(SIGMA_TYPE_META).map(([key, meta]) => {
          const n = typeCounts[key] || 0;
          /* A type with nothing in the window is not offered at all: a chip
             reading "0" invites a click that can only ever show an empty state. */
          if (!n) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => changeType(type === key ? null : key)}
              aria-pressed={type === key}
              className={`gr-sigma-filter${type === key ? ' active' : ''}`}
            >
              {meta.label} <span className="gr-sigma-filter-n">{n}</span>
            </button>
          );
        })}
      </div>

      {loading && <Spinner text="Loading Brilliant moves…" />}

      {!loading && error && <p className="chess-error">{error}</p>}

      {!loading && !error && moves.length === 0 && (
        /* The empty state has to say WHY it is empty, because "0" on its own
           is indistinguishable from "the feature is broken". When the widest
           range is already selected there is no wider range left, so that is the
           one case where the answer is simply "you have none yet". */
        <div className="gr-sigma-empty">
          <p className="chess-empty">{emptyMessage}</p>
          {range !== 'all' && (
            <Button
              type="button"
              variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs"
              onClick={() => changeRange('all')}
            >
              Search all time
            </Button>
          )}
        </div>
      )}

      {!loading && !error && moves.length > 0 && (
        <>
          <div className="gr-sigma-grid">
            {moves.map((m) => {
              const meta = SIGMA_TYPE_META[m.sigmaType] || { label: 'Brilliant' };
              /* Derived from the stored move itself (see sigmaDisplay.js) — no
                 verdict is decided here, only where the board draws it. */
              const cardBoard = sigmaCardBoard(m);
              const cardBadge = destinationBadge(m.fromSquare, m.toSquare);
              return (
                <button
                  key={`${m.gameSource}-${m.gameId}-${m.ply}`}
                  type="button"
                  className="gr-sigma-card"
                  /* The whole card opens the game AT this move — the ply is
                     resolved to a move index here (one conversion, one place) so
                     no consumer can reach for the move number instead and land
                     on White's move when the brilliant one was Black's. */
                  /* `m.moveCount` is not part of the stored row, so the total is
                     deliberately not passed: an unknown length must NOT clamp to
                     zero (which would drop the board on the starting position).
                     The card clamps against the real move list once it has the
                     game. */
                  onClick={() => onOpenGame && onOpenGame(m, { moveIndex: plyToMoveIndex(m.ply) })}
                  title={`${meta.label} — move ${m.moveNumber}. Open the game at this move.`}
                >
                  <div className="gr-sigma-card-board">
                    {/* The board shows the position AFTER the move — sigmaCardBoard
                        replays the stored from/to on the stored fenBefore. Drawing
                        fenBefore left the destination square holding the piece being
                        captured and the sacrifice not yet made, which is precisely the
                        moment a brilliant move is about. Colour and destination
                        highlight come from the canonical Brilliant meta, so the arrow,
                        the square and the badge below all read as one tier. */}
                    {cardBoard ? (
                      <ChessBoard
                        fen={cardBoard.fen}
                        boardWidth={196}
                        interactive={false}
                        showNotation={false}
                        frameless
                        soundOn={false}
                        orientation={playedColor(m)}
                        lastMove={{ from: cardBoard.from, to: cardBoard.to }}
                        reviewVerdictColor={cardBoard.color}
                        moveBadge={cardBadge ? { ...cardBadge, verdict: SIGMA_VERDICT, sacrifice: Boolean(m.sacrifice) } : null}
                        customArrows={[
                          {
                            from: cardBoard.from,
                            to: cardBoard.to,
                            color: cardBoard.color,
                          },
                        ]}
                      />
                    ) : (
                      /* No stored FEN — say so rather than drawing an empty grid
                         that looks like a position with no pieces. */
                      <div className="gr-sigma-card-nofn">
                        <span>Position unavailable</span>
                        <span className="gr-sigma-card-nofn-hint">{m.moveSan || '—'}</span>
                      </div>
                    )}
                    <span className="gr-sigma-card-sig" aria-hidden="true">σ</span>
                  </div>
                  <div className="gr-sigma-card-body">
                    <span className="gr-sigma-card-move">
                      {m.moveNumber}{m.playedBy === 'black' ? '…' : '.'} {m.moveSan || '—'}
                    </span>
                    <span className="gr-sigma-card-type">
                      <span className="gr-sigma-chip">
                        {meta.label}
                      </span>
                    </span>
                    <span className="gr-sigma-card-meta">
                      {m.sourceLabel}
                      {m.playedAt ? ` · ${shortDate(m.playedAt)}` : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="gr-sigma-pager">
              <Button
                type="button"
                variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span className="gr-sigma-page">Page {page} of {pageCount} · {total} total</span>
              <Button
                type="button"
                variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
              >
                Next →
              </Button>
            </div>
          )}

          {showingOther && (
            <p className="gr-hint">
              These are {data?.ownerName || 'another player'}&apos;s moves, not yours.
            </p>
          )}
        </>
      )}
    </div>
  );
}