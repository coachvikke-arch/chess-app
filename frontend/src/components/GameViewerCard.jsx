import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import ChessBoard from './ChessBoard';
import EvalBar from './EvalBar';
import { useToast } from './Toast';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { parsePgn, formatDate } from '../utils/pgnTools';
import { describeGameEnd } from '../lib/chessReplay';
import { reviewMetaFor } from '../utils/gameReview';
import { getDisplayVerdict } from '../utils/sigmaType';
import { analyzeCanonical, CANONICAL_ANALYSIS_VERSION, getCanonicalAnalysis } from '../utils/canonicalAnalysis';
import { persistSigmaMoves, canPersist } from '../utils/sigmaPersist';
import { stopEngineSearch, searchTopMoves, warmEngine as warmReviewEngine } from '../utils/nnueEngine';
import { copyText } from '../utils/clipboard';
import { followActiveMove } from '../utils/scrollActiveMove';
import useVisibleEffectHost from '../hooks/useVisibleEffectHost';
import { buildGamePgn } from '../utils/gamePgn';
import { useReviewKeys } from '../hooks/useReviewKeys';
import { playEffectForMove } from '../effects/moveEffect/playForMove';
import { clearMoveEffects } from '../effects/moveEffect';
import Button from './Button';

/* ──────────────────────────────────────────────────────────────────────────
 * The full-game analysis card, shared by the Chess Profile Games tab and the
 * Brilliant (Sigma) Moves list.
 *
 * ONE card, one board, one move list, one classification source. The Brilliant
 * list opens THIS component rather than building its own, so a brilliant move
 * arrives at exactly the same experience as opening the game from the profile:
 * full move list, every move's canonical verdict and badge, navigation, and the
 * board positioned on the selected move.
 *
 * CLASSIFICATION IS NEVER COMPUTED HERE. The board/move-list read whatever the
 * canonical pipeline produced (see utils/canonicalAnalysis.js) — the same rows
 * Game Review, Chess Profile and GM Game display. `initialMoveIndex` is where
 * the board starts; it is a MOVE COUNT (the position after that many moves),
 * which is what makes "the selected brilliant move is already on the board" true.
 */

/* Fit the board square to the space the card actually has.
 *
 * The card is FULL SCREEN now, so the board is bounded by BOTH axes: the
 * column's width and the column's height (minus the frame around the board and
 * the nav row under it). The board is measured by the column, so it follows the
 * viewport on both a phone (height-bound) and a desktop without ever being cut
 * off — and the nav row with the copy and Analyze buttons always stays on
 * screen.
 *
 * The frame is the themed band around the squares: `remC` (20-46px, scaled
 * with the board) plus a 13px border/padding on each side — the same math
 * ChessBoard uses. It grows with the board, so the size is solved by a couple
 * of converging passes rather than a fixed guess. */
const NAV_ALLOWANCE = 52;

/* Room reserved to the LEFT of the board for the shared 36px eval bar plus its
 * gap. Subtracted from the column before the board is fitted, so the bar can
 * never push the board past the column or out of the modal on a phone. */
const EVAL_VIEWER_SLOT = 46;

/* The board is deliberately drawn LARGER than the space it fits into (the
 * request was "make the board 20% bigger"). A board that is only as big as the
 * free space leaves a wide empty margin on a desktop screen, where the card is
 * now full-screen; a bigger board fills it.
 *
 * Because the bigger board can be taller than the column, the column scrolls
 * (the board is never cropped — the whole board is always reachable) and the
 * nav row under it is pinned, so the move controls stay where they are. */
const BOARD_SCALE = 1.2;

const frameRemC = (bw) => Math.min(46, Math.max(20, Math.round(bw * 0.082)));
const frameOf = (bw) => 2 * (frameRemC(bw) + 13) + 26;

function fitBoardToColumn(col, row) {
  let bw = Math.min(col, row > 0 ? row : Infinity, 900);
  for (let i = 0; i < 5; i += 1) {
    const frame = frameOf(bw);
    const byWidth = col - frame;
    const byHeight = row > 0 ? row - frame - NAV_ALLOWANCE : Infinity;
    const next = Math.min(byWidth, byHeight, 900);
    if (Math.abs(next - bw) < 2) { bw = next; break; }
    bw = next;
  }
  const fitted = Math.max(180, bw);
  /* 20% bigger, but never wider than the column: a board wider than its
     column would be CROPPED, while a board taller than the column simply
     scrolls (the column is a scroll box and the nav row is pinned). So the
     width is a hard limit and the height is not. */
  const byWidth = Math.max(180, col - frameOf(fitted));
  return Math.round(Math.min(fitted * BOARD_SCALE, byWidth));
}

/** Copy the game as a real PGN — full tag pairs plus the custom-start FEN —
 *  so it pastes into Chess.com / Lichess / ChessBase with its identity intact.
 *  Brief inline confirmation, same pattern as the GM replay's copy button. */
function useCopyPgn(game, moves, initialFen) {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  const copy = async () => {
    const ok = await copyText(buildGamePgn({ game, moves, initialFen }));
    setState(ok ? 'done' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { state, copy };
}

/* The display projection of a canonical result: what the board overlay and the
 * move list read. `uci`, `bestUci` and `lines` MUST be carried through — they
 * are the only record of WHERE each move went and what the engine wanted
 * instead, and they are what the board overlay is built from.
 *
 * This is presentation only: the canonical result itself is never re-classified,
 * re-scored or trimmed before being cached. */
function projectReview(res) {
  const counts = { white: { ...res.white.counts }, black: { ...res.black.counts } };
  const verdicts = res.moves.map((m, i) => ({
    index: i, san: m.san, verdict: m.verdict,
    uci: m.uci || null,
    bestUci: m.bestUci || null,
    lines: Array.isArray(m.lines) ? m.lines : [],
    player: m.player === 'w' ? 'white' : 'black',
    cpl: m.cpl, loss: m.loss, acc: m.acc,
    /* The score AFTER this move, signed back to White's point of view (the
       canonical row stores it from the mover's side, exactly like GM replay).
       Presentation only — the stored analysis is never rewritten. */
    evalAfter: m.played == null ? null : (m.player === 'w' ? m.played : -m.played),
    mateAfter: m.playedMate == null ? null : (m.player === 'w' ? m.playedMate : -m.playedMate),
  }));
  return {
    verdicts,
    counts,
    accuracy: { white: res.white.accuracy, black: res.black.accuracy },
    analysisVersion: CANONICAL_ANALYSIS_VERSION,
  };
}

/**
 * @param {object} props
 * @param {object} props.game  { pgn, white_name, black_name, platform, time_class,
 *   time_control, game_date, opening, game_url } — any source, normalised to the
 *   profile field names so this card reads one shape.
 * @param {() => void} props.onClose
 * @param {number} [props.initialMoveIndex]  move count to start on (position
 *   AFTER that many moves). Defaults to the end of the game.
 * @param {string} [props.gameId]  profile-game id, enabling stored-analysis
 *   fetch/save. Omitted for games with no stored analysis row (a Brilliant from
 *   an online game), which then just offers "Analyze locally".
 * @param {object} [props.loadAnalysis] / [props.saveAnalysis]  injected so this
 *   component needs no service import and can be exercised headlessly.
 * @param {boolean} [props.manageHistory]  whether the card pushes its own
 *   history entry so the browser Back button closes it. Set to false when the
 *   OPENING SURFACE already owns the URL (a ?game= parameter): the URL entry
 *   then is the history entry, and a second one would make Back skip over the
 *   page the user came from.
 */
export default function GameViewerCard({ game = null,   gameRef = null,   resolveGame = null,   onClose,   initialMoveIndex = null,   gameId = null,   loadAnalysis = null,   saveAnalysis = null,   gameSource = 'chess_profile',   manageHistory = true, }) {
  useOverlayHistory('GameViewerCard', manageHistory, onClose);
  const { showToast } = useToast();

  /* ── the game may not be loaded yet ──────────────────────────────────────
     Opened from a Brilliant Move, the card is handed a game REFERENCE (the
     canonical source + id from the analysis) instead of a loaded game, because
     the row carries no PGN. The card still mounts IMMEDIATELY and resolves the
     game here, showing its own loading state.

     Loading before opening was the bug this replaces: the parent used to await
     the fetch and only then mount the card, so any failure — a missing game, an
     offline app, a gated endpoint — left the user with no visible response at
     all, which reads as "clicking does nothing". Opening first means there is
     always something on screen, and a failure is reported IN the card instead of
     in a toast that has already faded. */
  const [loaded, setLoaded] = useState(game);
  const [loadState, setLoadState] = useState(game ? 'ready' : (gameRef ? 'loading' : 'idle'));
  const [loadError, setLoadError] = useState('');
  const refKey = gameRef ? `${gameRef.gameSource}:${gameRef.gameId}` : null;

  useEffect(() => {
    if (game) {
      setLoaded(game);
      setLoadState(game.pgn ? 'ready' : 'error');
      if (!game.pgn) setLoadError('This game has no recorded moves.');
      return undefined;
    }
    if (!gameRef || !resolveGame) {
      setLoadState('error');
      setLoadError('No game to open.');
      return undefined;
    }
    let alive = true;
    setLoadState('loading');
    setLoadError('');
    Promise.resolve(resolveGame(gameRef))
      .then((g) => {
        if (!alive) return;
        if (g && g.pgn) { setLoaded(g); setLoadState('ready'); return; }
        setLoadState('error');
        setLoadError('That game could not be found in your history.');
      })
      .catch((err) => {
        if (!alive) return;
        setLoadState('error');
        setLoadError(err?.response?.data?.message || err?.message || 'That game could not be opened.');
      });
    return () => { alive = false; };
  }, [game, refKey, resolveGame]); // eslint-disable-line react-hooks/exhaustive-deps

  const gameData = loaded || { pgn: '', white_name: '', black_name: '' };

  const parsed = useMemo(() => parsePgn(gameData.pgn || ''), [gameData.pgn]);
  /* `initFen` is forwarded because a game that does not start from the standard
     position must be replayed from its real origin. */
  const endInfo = useMemo(
    () => describeGameEnd(parsed.result, gameData.pgn || '', parsed.moves, parsed.initFen),
    [parsed.result, parsed.moves, parsed.initFen, gameData.pgn],
  );

  const whiteLabel = gameData.white_name || 'Unknown player';
  const blackLabel = gameData.black_name || 'Unknown player';
  const moveCount = Math.ceil(parsed.moves.length / 2);
  const board = useRef(null);
  /* The effect host id of THIS card's board.
     The card is opened over another board (the review board behind it, the
     profile page), and a move effect that names no board goes to the board the
     user touched LAST — which is the one behind the card. The effect would
     then play somewhere the user is not looking and this card's board would
     stay still. Naming the board here addresses every effect to it. */
  const effectHostId = useId();
  /* The card is an overlay: while it is open it IS the board the user is
     looking at, so it owns the effect target. The previous owner is restored
     when the card closes. */
  useVisibleEffectHost(effectHostId);
  /* Start position: the requested move (the selected Brilliant move already
     played), else the end of the game. Clamped to the real move list, so a stale
     request can never point past the last move. This is the ONLY place the ply
     becomes a board position. */
  const startIndex = useMemo(() => {
    const n = parsed.moves.length;
    if (initialMoveIndex == null) return n;
    const i = Math.floor(Number(initialMoveIndex));
    if (!Number.isFinite(i)) return n;
    return Math.max(0, Math.min(n, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.moves.length, initialMoveIndex]);
  const [moveIndex, setMoveIndex] = useState(startIndex);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState(null);
  const [orientation, setOrientation] = useState('white');
  const [review, setReview] = useState(null);
  const [revState, setRevState] = useState('loaded'); // loaded | running | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const revToken = useRef(0);
  const unmounted = useRef(false);
  const boardColRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(320);
  const { state: pgnCopied, copy: copyPgn } = useCopyPgn(gameData, parsed.moves, parsed.initFen);

  useEffect(() => {
    // React StrictMode (dev) runs effects mount→cleanup→mount on the same
    // instance, so the cleanup would leave `unmounted` stuck true and cancel
    // every review instantly (stuck at 0%). Reset it on mount.
    unmounted.current = false;
    return () => { unmounted.current = true; revToken.current++; };
  }, []);

  /* Warm the NNUE pool as soon as the viewer opens so the first "Analyze
     locally" click doesn't stall on the engine download/compile. */
  useEffect(() => { try { warmReviewEngine(); } catch { /* best effort */ } }, []);

  /* Size the board to its actual column (frame-aware) so the modal never cuts
     off the board on narrower screens. Re-runs when `loadState` settles: a card
     opened from Brilliant Moves mounts in a loading state with NO board column,
     so a mount-only measure reads the 340px fallback and the board stays small
     until the next manual resize. A ResizeObserver on the column (not just
     window resize) also absorbs late layout shifts — web fonts, the modal
     scrollbar appearing, the side panel wrapping. */
  useEffect(() => {
    const measure = () => {
      const box = boardColRef.current ? boardColRef.current.getBoundingClientRect() : null;
      const col = box ? box.width : 340;
      const row = box ? box.height : 0;
      setBoardWidth((prev) => {
        const next = fitBoardToColumn(Math.max(0, col - EVAL_VIEWER_SLOT), row);
        return prev === next ? prev : next;
      });
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && boardColRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(boardColRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [loadState]);

  function go(idx, animate = true, source = 'viewer-nav') {
    /* Loading a game/position is not a move: any effect from the previous
       position is over before the board is rebuilt. An animated navigation
       (next/prev/move click) goes through playEffectForMove below, which
       clears a stale effect and starts the new move's effect when it has one. */
    if (!animate) clearMoveEffects(source);
    const target = Math.max(0, Math.min(parsed.moves.length, idx));
    const g = new Chess(parsed.initFen === 'start' ? undefined : parsed.initFen);
    for (let i = 0; i < target; i++) {
      try { g.move(parsed.moves[i]); } catch { break; }
    }
    board.current = g;
    setMoveIndex(target);
    setFen(g.fen());
    const hist = g.history({ verbose: true });
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    if (animate) {
      const row = review?.verdicts?.[target - 1] || null;
      /* The event is read from the MOVE DATA, not from a badge: a promotion
         from the verbose move, a mate from the position the move produced, and
         a brilliant from the engine's own classification once the analysis
         has landed. `boardId` makes sure the effect is played on THIS board. */
      playEffectForMove(target, source, {
        game: g,
        verdict: row?.verdict || null,
        sacrifice: Boolean(row?.sacrifice),
        orientation,
        boardId: effectHostId,
      });
    }
  }

  /* Re-establish the board whenever the game (or the requested move) changes —
     including the first load, so opening a Brilliant move lands on its position
     rather than on the start of the game. */
  useEffect(() => {
    go(startIndex, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.initFen, startIndex, loadState]);

  /* Restore a stored analysis, but ONLY through the canonical layer: it validates
     the version, the schema, the game identity and the game's own content, and
     returns null for anything stale or corrupt. `reuseOnly` means opening the
     card NEVER starts an engine run — an already-analysed game appears instantly,
     and a first-time game waits for the user to press Analyze. */
  useEffect(() => {
    if (!loadAnalysis || !gameId) return undefined;
    let alive = true;
    Promise.resolve(getCanonicalAnalysis(
      { gameSource, gameId, initialFen: parsed.initFen, moves: parsed.moves },
      { reuseOnly: true, loadAnalysis },
    ))
      .then((res) => {
        if (alive && res) { setReview(projectReview(res)); setRevState('done'); }
      })
      .catch(() => { });
    return () => { alive = false; };
  }, [gameId, gameSource, loadAnalysis, parsed.initFen, loaded?.pgn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Keyboard: ←/→ prev/next, ↑/Home first, ↓/End last, F flip. One listener,
     always active while the card is mounted (no need to click the board). */
  useReviewKeys({
    prev: () => go(moveIndex - 1, true, 'keyboard'),
    next: () => go(moveIndex + 1, true, 'keyboard'),
    first: () => go(0, true, 'keyboard'),
    last: () => go(parsed.moves.length, true, 'keyboard'),
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  });

  /* Keep the active move visible INSIDE the score sheet. scrollIntoView() would
     scroll the document as well, which moved the page on every step. */
  const scoreRef = useRef(null);
  useEffect(() => {
    followActiveMove(scoreRef.current, '.cp-score-cell.is-active');
  }, [moveIndex]);

  function cancelAnalysis() {
    revToken.current++;
    setRevState(review ? 'done' : 'loaded');
    stopEngineSearch();
  }

  async function runAnalysis() {
    if (revState === 'running' || !parsed.moves.length) return;
    const token = ++revToken.current;
    setRevState('running');
    setProgress(0);
    setError(null);
    /* Explicit engine pre-flight: if Stockfish can't boot (wasm blocked / failed
       handshake) we fail fast with a clear message instead of the review pipeline
       silently hanging on its first search forever. */
    try {
      await searchTopMoves(parsed.initFen === 'start' ? new Chess().fen() : parsed.initFen, { maxDepth: 4, multiPv: 1 });
    } catch {
      if (token !== revToken.current) return;
      setRevState('error');
      setError('The chess engine could not start (Stockfish WebAssembly failed to load or boot). Try again in a moment.');
      return;
    }
    let watchdog = null;
    const timedOut = new Promise((resolve) => { watchdog = setTimeout(() => resolve({ timedOut: true }), 300000); });
    try {
      /* The canonical pipeline with the canonical engine config — the same call
         Game Review and GM Game analysis make. No local depth/multiPv overrides.
         Routed through getCanonicalAnalysis so a game analysed before (this
         session, or a previous one) is reused instead of re-run, and so two
         surfaces asking at once produce ONE engine run. `force` is the explicit
         "Re-analyze" intent. */
      const res = await Promise.race([
        getCanonicalAnalysis(
          { gameSource, gameId, initialFen: parsed.initFen, moves: parsed.moves },
          { force: true, loadAnalysis, saveAnalysis, onProgress: (done, total) => { if (token === revToken.current) setProgress(Math.round((done / total) * 100)); }, isCancelled: () => token !== revToken.current || unmounted.current },
        ),
        timedOut,
      ]);
      clearTimeout(watchdog);
      if (res && res.timedOut) {
        revToken.current++;
        stopEngineSearch();
        setRevState('error');
        setError('Analysis timed out after 5 minutes — the engine did not respond. Try again.');
        return;
      }
      if (token !== revToken.current || !res) return;
      /* One canonical result, projected for display. The cache/persistence
         decision was already made by getCanonicalAnalysis — this component
         never decides whether the engine should run. */
      const payload = projectReview(res);
      setReview(payload);
      setRevState('done');
      /* File the Sigmas this review found against the imported game, so the
         Brilliant Moves list can list them. */
      if (canPersist(gameSource, gameId != null ? Number(gameId) : gameId)) {
        persistSigmaMoves({
          review: res,
          gameSource,
          gameId: Number(gameId),
          initialFen: parsed.initFen,
          moves: parsed.moves,
          meta: {
            playedAt: gameData.game_date || null,
            whiteName: gameData.white_name || null,
            blackName: gameData.black_name || null,
            whiteRating: gameData.white_rating,
            blackRating: gameData.black_rating,
          },
        });
      }
    } catch {
      clearTimeout(watchdog);
      if (token === revToken.current) { setRevState('error'); setError('Analysis failed — the engine could not evaluate this game. Try again.'); }
    }
  }

  const verdicts = review?.verdicts || null;
  const myColor = gameData.my_color || 'white';
  /* Canonical accuracy only: it always ships with the review. */
  const accuracyForSide = (side) => review?.accuracy?.[side] ?? null;
  const mineAccuracy = accuracyForSide(myColor);
  const oppAccuracy = accuracyForSide(myColor === 'white' ? 'black' : 'white');
  const curVerdict = verdicts && moveIndex > 0 ? verdicts[moveIndex - 1]?.verdict || null : null;
  /* Evaluation of the position on screen: the row of the move that produced it.
     No verdict yet (start of the game, or a move the engine could not score)
     reads as a neutral 0.0 / level bar instead of a missing bar or a stale one. */
  const evalRow = verdicts && moveIndex > 0 ? verdicts[moveIndex - 1] : null;
  const evalCp = evalRow?.evalAfter ?? 0;
  const evalMate = evalRow?.mateAfter ?? null;

  const moveBadge = useMemo(() => {
    const v = verdicts && moveIndex > 0 ? verdicts[moveIndex - 1] : null;
    if (!v || !v.uci || v.uci.length < 4) return null;
    const to = v.uci.slice(2, 4);
    return {
      verdict: v.verdict,
      sacrifice: Boolean(v.sacrifice),
      square: to,
      file: to.charCodeAt(0) - 97,   // 0-7
      rank: Number(to[1]) - 1,       // 0-7
    };
  }, [verdicts, moveIndex]);

  /* ── board overlay: the engine's BEST move, one arrow ──
     Row `moveIndex` is the move that comes NEXT from the position on screen, so
     its `lines` are the suggestions for the board being looked at. Only the best
     move is drawn: the 2nd and 3rd engine preferences are not alternatives a
     student should read as "also fine". */
  const TOP_LINE_COLOR = 'rgba(0, 128, 0, 1)';
  const lineArrows = useMemo(() => {
    const row = verdicts && moveIndex < verdicts.length ? verdicts[moveIndex] : null;
    const ls = row && Array.isArray(row.lines) ? row.lines : [];
    if (!ls.length) return [];
    return ls.slice(0, 1)
      .map((l) => ({
        from: l.from || (l.uci ? l.uci.slice(0, 2) : null),
        to: l.to || (l.uci ? l.uci.slice(2, 4) : null),
        color: TOP_LINE_COLOR,
      }))
      .filter((a) => a.from && a.to);
  }, [verdicts, moveIndex]);

  void showToast;

  /* Loading / failure states live INSIDE the card, so a click always produces
     a visible response. The card mounts the moment it is asked for and only then
     fetches; a failure replaces the body with the reason instead of leaving the
     user on an unchanged screen. */
  if (loadState === 'loading') {
    return createPortal(
      <div className="cp-viewer-overlay" onClick={onClose}>
        <div className="cp-viewer" onClick={(e) => e.stopPropagation()}>
          <div className="cp-viewer-head">
            <div className="min-w-0">
              <p className="cp-viewer-title truncate">Opening game…</p>
              <p className="cp-viewer-sub">Loading the full game and its analysis</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="cp-viewer-close" onClick={onClose} title="Close">✕</button>
            </div>
          </div>
          <div className="cp-viewer-body">
            <div className="cp-mv-empty p-4" style={{ width: '100%', textAlign: 'center' }}>
              Loading the game…
            </div>
          </div>
        </div>
      </div>
    , document.body);
  }

  if (loadState === 'error') {
    return createPortal(
      <div className="cp-viewer-overlay" onClick={onClose}>
        <div className="cp-viewer" onClick={(e) => e.stopPropagation()}>
          <div className="cp-viewer-head">
            <div className="min-w-0">
              <p className="cp-viewer-title truncate">Could not open this game</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="cp-viewer-close" onClick={onClose} title="Close">✕</button>
            </div>
          </div>
          <div className="cp-viewer-body">
            <div className="cp-mv-empty p-4" style={{ width: '100%', textAlign: 'center' }}>
              {loadError}
            </div>
          </div>
        </div>
      </div>
    , document.body);
  }

  return createPortal(
    <div className="cp-viewer-overlay" onClick={onClose}>
      <div className="cp-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="cp-viewer-head">
          <div className="min-w-0">
            {/* Modal title: which game is open. Distinct from the score sheet
                below, which is the game RECORD (players, result, moves). */}
            <p className="cp-viewer-title truncate">{whiteLabel} vs {blackLabel}</p>
            <p className="cp-viewer-sub">
              {gameData.platform === 'lichess' ? 'Lichess' : 'Chess.com'} · {gameData.time_class} {gameData.time_control ? `(${gameData.time_control})` : ''} · {formatDate(gameData.game_date)}
              {gameData.opening ? ` · ${gameData.opening}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a className="cp-viewer-link" href={gameData.game_url || '#'} target="_blank" rel="noopener noreferrer" title="Open on the original site">↗</a>
            <button className="cp-viewer-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        <div className="cp-viewer-body">
          <div ref={boardColRef} className="cp-viewer-board">
            <div className="cp-viewer-board-row">
              {/* The shared Game Review bar, immediately left of the board and
                  exactly one square-area tall, so it shrinks with the board and
                  flips with it. */}
              <EvalBar
                evaluation={evalCp}
                mate={evalMate}
                orientation={orientation}
                /* Stretch to the board's REAL rendered height: the themed frame
                   adds a band around the squares, so a square-width bar would
                   stop short of the board it belongs to. */
                height="auto"
              />
              {/* The board is wrapped in its own flex box so the row measures
                  the themed frame exactly. ChessBoard's root is an inline-block,
                  which would otherwise add a line-box descender under the board
                  and leave the stretched bar ~7px longer than the board. */}
              <div className="cp-viewer-board-slot">
                <ChessBoard
                  game={board.current}
                  mode="analysis"
                  orientation={orientation}
                  boardWidth={boardWidth}
                  interactive={false}
                  customArrows={lineArrows}
                  /* This card's board answers to a named host, so a move effect
                     is played HERE and not on a board behind the card. */
                  moveEffectHostId={effectHostId}
                  /* No rank chip: there is only one arrow, so the numbered badge
                     could only ever read "1". */
                  lineBadges={null}
                  moveBadge={moveBadge}
                  lastMove={lastMove}
                  /* Canonical verdict colour for the selected move's destination
                     square — the same mapping the review board uses. */
                  reviewVerdictColor={reviewMetaFor(curVerdict)?.color || null}
                />
              </div>
            </div>

            <div className="cp-nav">
              <button className="cp-nav-btn" disabled={moveIndex === 0} onClick={() => go(0)} title="Start">⏮</button>
              <button className="cp-nav-btn" disabled={moveIndex === 0} onClick={() => go(moveIndex - 1)} title="Previous">◀</button>
              <span className="cp-nav-count">{moveIndex} / {parsed.moves.length}</span>
              <button className="cp-nav-btn" disabled={moveIndex >= parsed.moves.length} onClick={() => go(moveIndex + 1)} title="Next">▶</button>
              <button className="cp-nav-btn" disabled={moveIndex >= parsed.moves.length} onClick={() => go(parsed.moves.length)} title="End">⏭</button>
              <button className="cp-nav-btn" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board">⇄</button>
            </div>
          </div>

          <div className="cp-viewer-side">
            {/* Score sheet panel — same model as the GM replay's score sheet:
                an eyebrow label, the two players named with their colour, a move
                count, the actions, then a sticky `# | White | Black` column head
                over the move table.

                Deliberately NOT reusing the `.gm-*` classes. Those are painted for
                the GM palette (a dark slate board, `#d8e8f1` moves, `#16232f`
                header) and this viewer is a warm cream page — the dark tokens
                would be near-unreadable here. So the MODEL is mirrored under
                `cp-score*` names with light-theme values, which is why the two
                cannot drift apart silently: if GM's structure changes, the parity
                test below fails and both get updated together. */}
            <div className="cp-score-head">
              <div className="cp-score-head-main">
                <span className="cp-score-eyebrow">Score sheet</span>
              </div>
              <div className="cp-score-head-side">
                <span className="cp-score-badge">
                  {moveCount} {moveCount === 1 ? 'move' : 'moves'}
                </span>
                {/* Copy PGN — an icon button, NOT a text button. The head row
                     wraps (see .cp-score-head-side), so a labelled button made it
                     wrap onto a second line and knocked the badge and Analyze out
                     of alignment with the score-sheet eyebrow. A fixed 34px square
                     matches .cp-nav-btn (the cancel control beside it) and keeps
                     the row one line. Confirmation is the glyph itself: it swaps
                     ⧉ → ✓ and back, so the button never changes width and the row
                     cannot shift even momentarily. */}
                <button
                  className={`cp-nav-btn${pgnCopied === 'done' ? ' is-done' : ''}${pgnCopied === 'failed' ? ' is-failed' : ''}`}
                  onClick={copyPgn}
                  disabled={parsed.moves.length === 0}
                  title={pgnCopied === 'done' ? 'PGN copied'
                    : (pgnCopied === 'failed' ? 'Copy failed — select the PGN manually'
                      : 'Copy this game as PGN')}
                  aria-label="Copy this game as PGN"
                >
                  {pgnCopied === 'done' ? '✓' : (pgnCopied === 'failed' ? '!' : '⧉')}
                </button>
                {revState === 'running' && (
                  <button className="cp-nav-btn" onClick={cancelAnalysis} title="Cancel analysis">✕</button>
                )}
                <Button variant="primary" size="sm" className="!px-3 !py-1.5 !text-xs" onClick={runAnalysis} disabled={revState === 'running' || parsed.moves.length === 0}>
                  {revState === 'running' ? `Analyzing… ${progress}%` : (review ? '↺ Re-analyze' : '🧠 Analyze locally')}
                </Button>
              </div>
            </div>

            {/* Result and why the game ended. */}
            <p className="cp-score-result">
              <b>{endInfo.result}</b>
              <span>{endInfo.headline}</span>
              {endInfo.confidence === 'result-only' && endInfo.winner !== 'Unknown' && (
                <em className="cp-score-unstated">reason not stated</em>
              )}
            </p>

            {revState === 'running' && (
              <div className="analysis-progress mb-2"><div style={{ width: `${progress}%` }} /></div>
            )}
            {error && (
              <p className="cp-mv-empty mb-2">{error}</p>
            )}
            {review && (
              <div className="cp-accuracy mb-2">
                <span className={myColor === 'white' ? 'cp-acc-win' : ''}>⚪ {mineAccuracy ?? '—'}%</span>
                <span className={myColor === 'black' ? 'cp-acc-win' : ''}>⚫ {oppAccuracy ?? '—'}%</span>
                <span className="text-black/55">accuracy</span>
              </div>
            )}
            <div className="cp-score" role="list" aria-label="Game moves" ref={scoreRef}>
              {parsed.moves.length === 0 ? (
                <p className="cp-mv-empty">No moves recorded for this game.</p>
              ) : (
                <>
                  {/* Sticky column head, as in the GM score sheet. */}
                  <div className="cp-score-row cp-score-row--head" role="row">
                    <span role="columnheader">#</span>
                    <span role="columnheader" className="is-white">{whiteLabel}</span>
                    <span role="columnheader" className="is-black">{blackLabel}</span>
                  </div>
                  {Array.from({ length: Math.ceil(parsed.moves.length / 2) }, (_, i) => (
                    <div className="cp-score-row" role="row" key={i}>
                      <span className="cp-score-num" role="rowheader">{i + 1}.</span>
                      {[0, 1].map((off) => {
                        const idx = i * 2 + off;
                        /* A real empty cell, not a missing one: the columns must
                           stay aligned when a game ends after White's move. */
                        if (idx >= parsed.moves.length) {
                          return <span className="cp-score-cell is-empty" role="gridcell" key={off} />;
                        }
                        const v = verdicts ? verdicts[idx] : null;
                        const meta = v ? reviewMetaFor(v.verdict) : null;
                        /* The cell colour is a CSS hook keyed by the legacy tier
                           name, so it has to be the DISPLAY key. */
                        const grade = v?.verdict ? ` is-${getDisplayVerdict(v.verdict).toLowerCase()}` : '';
                        return (
                          <button
                            key={off}
                            type="button"
                            role="gridcell"
                            title={meta ? `${getDisplayVerdict(v.verdict)}` : undefined}
                            className={`cp-score-cell${idx + 1 === moveIndex ? ' is-active' : ''}${grade}`}
                            onClick={() => go(idx + 1)}
                          >
                            {meta && <span className="cp-score-badge-glyph">{meta.glyph}</span>}
                            {parsed.moves[idx]}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  , document.body);
}