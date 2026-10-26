import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../components/Button';
import { Chess } from 'chess.js';
import ChessBoard from './ChessBoard';
import { buildScoreRows, gameStartsBlack } from '../lib/scoreSheet';
import { useBoardWidth } from '../pages/Library';
import {
  joinGameRoom,
  leaveGameRoom,
  onGameUpdate,
  joinSpec,
  leaveSpec,
  onSpecUpdate,
  onSpecEnd,
} from '../services/socket';

function fmtClock(ms, forceFloor) {
  const s = Math.max(0, ms / 1000);
  const secs = forceFloor ? Math.floor(s) : Math.ceil(s);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const r = String(secs % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${r}`;
  return `${m}:${r}`;
}

const REASON_LABELS = {
  checkmate: 'Checkmate',
  resigned: 'Resignation',
  resignation: 'Resignation',
  timeout: 'Timeout',
  stalemate: 'Stalemate',
  repetition: 'Repetition',
  'threefold-repetition': 'Repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  'insufficient-material': 'Insufficient material',
  agreement: 'Agreement',
  armageddon: 'Armageddon',
  forfeit: 'Forfeit',
};

function resultLabel(status, result, reason, whiteName, blackName) {
  if (status !== 'finished') return 'Live';
  const why = REASON_LABELS[reason] || '';
  if (result === 'white') return why ? `${whiteName || 'White'} wins · ${why}` : `${whiteName || 'White'} wins`;
  if (result === 'black') return why ? `${blackName || 'Black'} wins · ${why}` : `${blackName || 'Black'} wins`;
  if (result === 'draw') return why ? `Draw · ${why}` : 'Draw';
  if (result === 'abandoned') return why ? `Draw · ${why}` : 'Draw by agreement';
  if (result === 'aborted') return 'Match aborted';
  return 'Finished';
}

/**
 * Live spectator view of a chess game.
 *
 * `session` is EITHER:
 *  - an online PvP neutral payload: { type:'online', gameId, whiteName, blackName,
 *    fen, pgn, clock:{whiteMs,blackMs,...}, status, result, ... }
 *  - a computer-game session:          { type:'computer', key, whiteName, blackName,
 *    fen, pgn, whiteMs, blackMs, turn, status, result, level, ... }
 *
 * Renders a read-only board, both clocks, the SAN move list and the result;
 * live-updates arrive over the socket.
 */
export default function SpectatorBoard({ session, boardWidth = 380, onClose, onBack, embedded = false, bare = false, boardCap = 460, lockBlackTop = false, compact = false }) {
  const [snap, setSnap] = useState(() => seed(session));
  const [boardRef, fittedWidth] = useBoardWidth();
  const gameRef = useRef(null);
  const [autoOrientation, setAutoOrientation] = useState(null); // follows side to move in embedded cards
  const [manualOrientation, setManualOrientation] = useState(null); // manual flip wins once used
  const orientationRef = useRef('black');
  const [tick, setTick] = useState(0);

  const { gameId, key } = session;
  const isOnline = session.type === 'online';
  /* Embedded grid cards fill their column: the measured width (capped by
     boardCap) instead of the old fixed 340, so the desktop card reads big.
     Compact row boards are a fixed small square — names + clocks only. */
  const boardW = compact ? 300 : embedded ? Math.max(340, Math.min(fittedWidth, boardCap)) : boardWidth;

  /* controlled Chess instance rebuilding as new snapshots arrive */
  useEffect(() => {
    const g = new Chess();
    try {
      if (snap.pgn && snap.pgn.trim()) g.loadPgn(snap.pgn, { strict: false });
      else if (snap.fen && snap.fen !== 'start') g.load(snap.fen);
    } catch {
      /* keep start position */
    }
    gameRef.current = g;
    setTick((x) => x + 1);
  }, [snap.pgn, snap.fen]);

  /* subscriptions */
  useEffect(() => {
    if (isOnline && gameId) {
      joinGameRoom(gameId);
      const off = onGameUpdate(({ forSpectator }) => {
        if (forSpectator && forSpectator.gameId === gameId) applyOnline(forSpectator);
      });
      return () => {
        off();
        leaveGameRoom(gameId);
      };
    }
    if (!isOnline && key) {
      joinSpec(key);
      const offUpdate = onSpecUpdate(({ session: snapSession }) => {
        if (snapSession && snapSession.key === key) applySnap(snapSession);
      });
      const offEnd = onSpecEnd(({ key: endedKey }) => {
        if (endedKey === key) {
          setSnap((prev) => ({ ...prev, status: 'finished' }));
        }
      });
      return () => {
        offUpdate();
        offEnd();
        leaveSpec(key);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline ? gameId : key, isOnline]);

  /* local clock tick while the game is live */
  useEffect(() => {
    if (snap.status !== 'active') return;
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [snap.status]);

  function applyOnline(pl) {
    const c = pl.clock || {};
    setSnap({
      ...seed(pl),
      status: pl.status,
      result: pl.result,
      resultReason: pl.resultReason ?? null,
      whiteMs: c.whiteMs ?? pl.whiteMs ?? 0,
      blackMs: c.blackMs ?? pl.blackMs ?? 0,
      turn: c.turn || pl.turn || 'white',
      serverNow: pl.serverNow || Date.now(),
      incrementSeconds: pl.incrementSeconds ?? c.incrementSeconds ?? 0,
    });
  }

  function applySnap(s) {
    setSnap((prev) => ({
      ...prev,
      whiteMs: s.whiteMs ?? (prev.whiteMs),
      blackMs: s.blackMs ?? (prev.blackMs),
      turn: s.turn || prev.turn,
      status: s.status || prev.status,
      result: s.result ?? prev.result,
      fen: s.fen || prev.fen,
      pgn: s.pgn ?? prev.pgn,
      serverNow: s.serverNow || Date.now(),
      incrementSeconds: s.incrementSeconds ?? prev.incrementSeconds,
    }));
  }

  function seed(s) {
    return {
      whiteName: s.whiteName || 'White',
      blackName: s.blackName || 'Black',
      fen: s.fen || undefined,
      pgn: s.pgn || '',
      whiteMs: s.whiteMs ?? s.clock?.whiteMs ?? 0,
      blackMs: s.blackMs ?? s.clock?.blackMs ?? 0,
      turn: s.turn || s.clock?.turn || (s.moves ? (s.moves.length % 2 === 0 ? 'white' : 'black') : 'white'),
      status: s.status || (s.gameId ? 'active' : s.type === 'computer' ? 'active' : 'finished'),
      result: s.result || null,
      resultReason: s.resultReason || null,
      level: s.level || null,
      serverNow: s.serverNow || Date.now(),
      incrementSeconds: s.incrementSeconds ?? s.clock?.incrementSeconds ?? 0,
    };
  }

  const liveRemaining = useCallback(
    (color) => {
      const stored = color === 'white' ? snap.whiteMs : snap.blackMs;
      if (snap.status !== 'active' || snap.turn !== color) return Math.max(0, stored);
      return Math.max(0, stored - Math.max(0, Date.now() - (snap.serverNow || Date.now())));
    },
    [snap]
  );

  /* locked top-black view (classroom single-game spectate): black is always
     on top, so no auto-rotate and no flip — the arrangement is the contract. */
  const orientation = lockBlackTop ? 'black' : (manualOrientation || autoOrientation || orientationRef.current);
  const flip = () => {
    if (lockBlackTop) return;
    const next = orientation === 'white' ? 'black' : 'white';
    orientationRef.current = next;
    setManualOrientation(next);
    setTick((x) => x + 1);
  };

  /* embedded cards auto-rotate so the side to move is at the bottom */
  useEffect(() => {
    if (lockBlackTop) return;
    if (!embedded || manualOrientation || snap.status !== 'active') return;
    const next = snap.turn === 'black' ? 'black' : 'white';
    orientationRef.current = next;
    setAutoOrientation((prev) => (prev === next ? prev : next));
  }, [embedded, manualOrientation, snap.turn, snap.status]);

  const history = useMemo(() => (gameRef.current ? gameRef.current.history() : []), [snap.pgn, snap.fen, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoreRows = useMemo(
    () => buildScoreRows(history, gameStartsBlack(gameRef.current)),
    [history],
  );
  const whiteName = String(snap.whiteName || '').trim() || 'White';
  const blackName = String(snap.blackName || '').trim() || 'Black';
  const last = history.length ? gameRef.current.history({ verbose: true })[history.length - 1] : null;
  const fen = gameRef.current ? gameRef.current.fen() : (snap.fen || '');
  const turnGlyph = snap.turn === 'white' ? '⚪' : '⚫';
  const finished = snap.status === 'finished';
  const floor = (snap.incrementSeconds || 0) === 0 && finished;
  const sub = snap.level ? ` · ${snap.level}` : '';

  return (
    <div className={`${embedded ? 'spec-embed' : bare ? 'spec-bare' : 'spec-overlay'}${compact ? ' spec-compact' : ''}`} role="dialog" aria-modal={embedded || bare ? 'false' : 'true'} aria-label="Spectate game">
      <div className="spec-card">
        <div className="spec-head">
          {onBack && (
            <Button type="button" variant="secondary" size="sm" onClick={onBack} aria-label="Back to live games" title="Back to live games">← Back</Button>
          )}
          <span className="spec-title">👁 Spectating</span>
          <span className={`spec-chip ${finished ? 'spec-chip-end' : ''}`}>
            {finished ? resultLabel(snap.status, snap.result, snap.resultReason, whiteName, blackName) : 'LIVE'}
          </span>
          {onClose && (
            <button type="button" className="spec-close" onClick={onClose} aria-label="Close spectate" title="Close">✕</button>
          )}
        </div>
        <div className="spec-sub">{snap.whiteName} vs {snap.blackName}{sub}</div>

        <div className="spec-body">
          <div
            className={`spec-board-col${embedded && orientation === 'black' ? ' spec-flipped' : ''}`}
            ref={embedded ? boardRef : undefined}
            style={bare ? { width: boardW, maxWidth: '100%', margin: '0 auto' } : undefined}
          >
            {/* top row = side AWAY from viewer, bottom row = side to move (bottom) */}
            <div className={`spec-player-row ${snap.turn === (orientation === 'white' ? 'black' : 'white') && !finished ? 'spec-nl' : ''}`}>
              <span className="spec-pname">{orientation === 'white' ? snap.blackName : snap.whiteName} <span className="spec-glyph">{orientation === 'white' ? '⚫' : '⚪'}</span>{snap.turn === (orientation === 'white' ? 'black' : 'white') && !finished ? ' · to move' : ''}</span>
              <span className={`spec-clock ${snap.turn === (orientation === 'white' ? 'black' : 'white') && !finished ? 'spec-clock-run' : ''}`}>
                {fmtClock(liveRemaining(orientation === 'white' ? 'black' : 'white'), floor)}
              </span>
            </div>
            <ChessBoard
              game={gameRef.current || undefined}
              fen={fen}
              orientation={orientation}
              boardWidth={boardW}
              interactive={false}
              engineOn={false}
              lastMove={last ? { from: last.from, to: last.to } : null}
              highlightLastMove
            />
            {/* bottom row = viewer's side (side to move when rotated) */}
            <div className={`spec-player-row ${snap.turn === orientation && !finished ? 'spec-nl' : ''}`}>
              <span className="spec-pname">{orientation === 'white' ? snap.whiteName : snap.blackName} <span className="spec-glyph">{orientation === 'white' ? '⚪' : '⚫'}</span>{snap.turn === orientation && !finished ? ' · to move' : ''}</span>
              <span className={`spec-clock ${snap.turn === orientation && !finished ? 'spec-clock-run' : ''}`}>
                {fmtClock(liveRemaining(orientation), floor)}
              </span>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={flip} style={lockBlackTop ? { display: 'none' } : undefined}>⇅ Flip board</Button>
          </div>

          <div
            className="spec-moves-col"
            style={bare ? { width: boardW, maxWidth: '100%', margin: '0 auto' } : undefined}
          >
            <div className="spec-moves-title">♘ Moves <span className="spec-moves-count">{history.length}</span></div>
            <div className="spec-move-list" role="table" aria-label={`${whiteName} versus ${blackName} score sheet`}>
              {/* A score sheet carries the players' names in the sheet itself, not just
                  above the board: with 64 moves to scroll you must be able to see who
                  played each side without scrolling back up. Sticky inside the scroll
                  container, and the grid must stay identical to .spec-move-row or the SAN
                  drifts out of its column. */}
              <div className="spec-score-head" role="row">
                <span className="spec-score-num" role="columnheader" aria-label="Move number">#</span>
                <span
                  role="columnheader"
                  title={`White — ${whiteName}`}
                  className={`spec-score-name is-white${!finished && snap.turn === 'white' ? ' is-live' : ''}`}
                >
                  <span className="spec-score-glyph" aria-hidden="true">⚪</span>
                  <span className="spec-score-label">{whiteName}</span>
                </span>
                <span
                  role="columnheader"
                  title={`Black — ${blackName}`}
                  className={`spec-score-name is-black${!finished && snap.turn === 'black' ? ' is-live' : ''}`}
                >
                  <span className="spec-score-glyph" aria-hidden="true">⚫</span>
                  <span className="spec-score-label">{blackName}</span>
                </span>
              </div>
              {scoreRows.length === 0 ? (
                <p className="spec-moves-empty">No moves yet.</p>
              ) : (
                scoreRows.map((row) => (
                  <div key={row.label} className="spec-move-row" role="row">
                    <span className="spec-move-num" role="rowheader">{row.label}</span>
                    <span className={`spec-move${row.white ? '' : ' spec-move-empty'}`} role="cell">{row.white || ''}</span>
                    <span className={`spec-move${row.black ? '' : ' spec-move-empty'}`} role="cell">{row.black || ''}</span>
                  </div>
                ))
              )}
            </div>
            {finished && (
              <div className="spec-finished">🏁 {resultLabel(snap.status, snap.result, snap.resultReason, whiteName, blackName)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}