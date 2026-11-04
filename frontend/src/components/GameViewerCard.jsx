import { useEffect, useMemo, useRef, useState, useId, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import EvalBar from './EvalBar';
import ResponsiveBoard from './ResponsiveBoard';
import { useToast } from './Toast';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import useMediaQuery from '../hooks/useMediaQuery';
import { formatEvalScore } from '../lib/evalDisplay';
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
  /* Keyed by the row's own `ply` — the 0-based index of that move in the game —
     NOT by its position in the array. A cancelled or failed ply is dropped from
     the report, so once one row is missing the two stop agreeing, and every read
     below (arrow, badge, eval bar, sheet grade) would describe the move after
     the one it was asked about. A hole therefore reads as "no verdict here",
     which is true, instead of as the neighbouring move's verdict. */
  const verdicts = [];
  res.moves.forEach((m, i) => {
    const at = Number.isInteger(m.ply) ? m.ply : i;
    verdicts[at] = {
      index: at, san: m.san, verdict: m.verdict,
      uci: m.uci || null,
      bestUci: m.bestUci || null,
      lines: Array.isArray(m.lines) ? m.lines : [],
      player: m.player === 'w' ? 'white' : 'black',
      cpl: m.cpl, loss: m.loss, acc: m.acc,
      /* The engine's own sacrifice decision, read straight off the canonical row.
         Without it the badge and the move effect's brilliant flare could only ever
         describe a move that was classified before this card was opened, and a
         freshly analysed game would show the glyph on the sheet but no flare on the
         board. Presentation only — never a second classification. */
      sacrifice: Boolean(m.sacrifice),
      /* The score AFTER this move, signed back to White's point of view (the
         canonical row stores it from the mover's side, exactly like GM replay).
         Presentation only — the stored analysis is never rewritten. */
      evalAfter: m.played == null ? null : (m.player === 'w' ? m.played : -m.played),
      mateAfter: m.playedMate == null ? null : (m.player === 'w' ? m.playedMate : -m.playedMate),
    };
  });
  /* Dense array: a hole becomes an explicit null so the consumers that index by
     ply read "nothing here" rather than walking past an array element that React
     and `.map()` both skip. */
  for (let i = 0; i < verdicts.length; i += 1) if (!verdicts[i]) verdicts[i] = null;
  return {
    verdicts,
    counts,
    accuracy: { white: res.white.accuracy, black: res.black.accuracy },
    analysisVersion: CANONICAL_ANALYSIS_VERSION,
  };
}

/**
 * One row of the score sheet.
 *
 * Memoised because a 150-ply game is 75 of these, and every navigation used to
 * rebuild all of them — each with its own class string, title and a fresh
 * onClick — on top of the board work. The row's CONTENT (SAN, glyph, grade)
 * only ever changes with the analysis, while the highlight changes on every
 * step, so the highlight is passed as two booleans and only the rows whose
 * active cell actually moved re-render. Markup and class names are the same as
 * before: this is a render-cost change, not a design change.
 */
const ScoreRow = memo(function ScoreRow({ num, cells, activeWhite, activeBlack, onCell }) {
  return (
    <div className="cp-score-row" role="row">
      <span className="cp-score-num" role="rowheader">{num}.</span>
      {cells.map((v, off) => {
        /* A real empty cell, not a missing one: the columns must
           stay aligned when a game ends after White's move. */
        if (!v) return <span className="cp-score-cell is-empty" role="gridcell" key={off} />;
        const meta = v.verdict ? reviewMetaFor(v.verdict) : null;
        /* The cell colour is a CSS hook keyed by the legacy tier
           name, so it has to be the DISPLAY key. */
        const grade = v.verdict ? ` is-${getDisplayVerdict(v.verdict).toLowerCase()}` : '';
        const active = off === 0 ? activeWhite : activeBlack;
        return (
          <button
            key={off}
            type="button"
            role="gridcell"
            title={meta ? `${getDisplayVerdict(v.verdict)}` : undefined}
            className={`cp-score-cell${active ? ' is-active' : ''}${grade}`}
            onClick={() => onCell(v.ply)}
          >
            {meta && <span className="cp-score-badge-glyph">{meta.glyph}</span>}
            {v.san}
          </button>
        );
      })}
    </div>
  );
});

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
 * @param {(payload: {ref: {gameSource: string, gameId: string|number}, game: object}) => void}
 *   [props.onReviewComplete]  fires the moment a full Stockfish review of this
 *   game is on screen — a finished engine run OR a stored review restored intact.
 *   Never fires on an open alone or mid-analysis, so the surface that listens
 *   ("✔ Reviewed") can only mark games that were genuinely reviewed. `game` is
 *   the loaded row, so the listener reads the platform from the card's own data
 *   instead of re-looking it up.
 * @param {boolean} [props.manageHistory]  whether the card pushes its own
 *   history entry so the browser Back button closes it. Set to false when the
 *   OPENING SURFACE already owns the URL (a ?game= parameter): the URL entry
 *   then is the history entry, and a second one would make Back skip over the
 *   page the user came from.
 */
export default function GameViewerCard({ game = null,   gameRef = null,   resolveGame = null,   onClose,   initialMoveIndex = null,   gameId = null,   loadAnalysis = null,   saveAnalysis = null,   gameSource = 'chess_profile',   manageHistory = true,   onReviewComplete = null, }) {
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
  /* ONE position per ply, built once when the game loads.
     The board used to be rebuilt from the PGN on every navigation: a fresh Chess
     plus one `move()` per ply up to the target, and every one of those generates
     the full legal move list. On a 156-ply game that measured 27-59 ms of
     main-thread work per press and it grows with the game, which is what froze
     the page when Prev/Next were pressed quickly or held. Navigation is now a
     read of `positions[ply]`, and the ply index below is the only state.
     Each entry also carries the verbose move, so the move effect and the
     last-move marker are read from the table instead of re-walking the history
     on every step. */
  const positions = useMemo(() => {
    let g;
    try {
      g = new Chess(parsed.initFen === 'start' ? undefined : parsed.initFen);
    } catch {
      /* A PGN whose [FEN] tag the engine cannot load still has to open. */
      g = new Chess();
    }
    const out = [{ fen: g.fen(), lastMove: null, move: null }];
    for (let i = 0; i < parsed.moves.length; i += 1) {
      let move = null;
      try { move = g.move(parsed.moves[i]); } catch { break; }
      out.push({ fen: g.fen(), lastMove: { from: move.from, to: move.to }, move });
    }
    return out;
  }, [parsed.initFen, parsed.moves]);
  /* The plies the board can actually show. A move the replay could not apply
     stops the table, so this — not the raw PGN count — is what everything clamps
     to; a stale request can never point past a position that exists. */
  const plies = positions.length - 1;
  /* Start position: the requested move (the selected Brilliant move already
     played), else the end of the game. Clamped to the real move list, so a stale
     request can never point past the last move. This is the ONLY place the ply
     becomes a board position. */
  const startIndex = useMemo(() => {
    if (initialMoveIndex == null) return plies;
    const i = Math.floor(Number(initialMoveIndex));
    if (!Number.isFinite(i)) return plies;
    return Math.max(0, Math.min(plies, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plies, initialMoveIndex]);
  const [moveIndex, setMoveIndex] = useState(startIndex);
  /* One Chess instance for the life of the card. The board reads its position
     from this object, so a navigation changes what it holds instead of swapping
     the instance the board is mounted on. */
  const boardRef = useRef(null);
  if (!boardRef.current) boardRef.current = new Chess();
  const [orientation, setOrientation] = useState('white');
  const [review, setReview] = useState(null);
  const [revState, setRevState] = useState('loaded'); // loaded | running | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const revToken = useRef(0);
  const unmounted = useRef(false);
  /* Whether an analysis THIS card started is still running. A ref, because the
     unmount cleanup below has to read it as of its last render. */
  const runningRef = useRef(false);
  runningRef.current = revState === 'running';
  const isMobileBoard = useMediaQuery('(max-width: 900px)');
  const { state: pgnCopied, copy: copyPgn } = useCopyPgn(gameData, parsed.moves, parsed.initFen);
  /* The score sheet can be folded away on a phone so the board alone owns the
     screen; the board's width never depends on this (it is measured from its
     own column), so folding it never resizes the board. */
  const [sheetOpen, setSheetOpen] = useState(true);

  useEffect(() => {
    // React StrictMode (dev) runs effects mount→cleanup→mount on the same
    // instance, so the cleanup would leave `unmounted` stuck true and cancel
    // every review instantly (stuck at 0%). Reset it on mount.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      revToken.current++;
      /* A review this card started stops WITH the card. The pipeline only looks
         for cancellation between plies, so the search already dispatched would
         otherwise keep a worker burning on a game nobody is watching — and the
         pool is shared, so the next card pays for it. */
      if (runningRef.current) stopEngineSearch();
    };
  }, []);

  /* Warm the NNUE pool as soon as the viewer opens so the first "Analyze
     locally" click doesn't stall on the engine download/compile. */
  useEffect(() => { try { warmReviewEngine(); } catch { /* best effort */ } }, []);

  /* The one place a ply becomes a position: load the table entry, tell React
     which ply is showing, and let the stored MOVE DATA start the effect.
     Nothing here is async and nothing here touches the engine, so navigation can
     never leave the board waiting on a promise that failed or hung. */
  function applyNav(target, animate, source) {
    const ply = Math.max(0, Math.min(plies, target));
    const pos = positions[ply];
    if (!pos) return;
    const g = boardRef.current;
    try { g.load(pos.fen); } catch { /* the table only holds legal positions */ }
    /* The ply the board is on NOW, as of this call — not as of the last render.
       A step queued in the same frame as a flush must count from here, or the
       press that arrives before React commits lands on the position it just
       left and is silently dropped. */
    appliedPlyRef.current = ply;
    setMoveIndex(ply);
    /* Loading a game/position is not a move: any effect from the previous
       position is over before the board shows it. */
    if (!animate) { clearMoveEffects(source); return; }
    const row = review?.verdicts?.[ply - 1] || null;
    /* The event is read from the MOVE DATA, not from a badge: a promotion from
       the verbose move (handed over straight from the table, so no history is
       re-walked), a mate from the position the move produced, and a brilliant
       from the engine's own classification once the analysis has landed.
       `boardId` makes sure the effect is played on THIS board. */
    playEffectForMove(ply, source, {
      game: g,
      move: pos.move,
      verdict: row?.verdict || null,
      sacrifice: Boolean(row?.sacrifice),
      orientation,
      boardId: effectHostId,
    });
  }

  /* Rapid Prev/Next — a held arrow key, an eager thumb — used to mean one full
     rebuild per press. Animated navigation is now queued into the frame that will
     paint it: a step accumulates (five quick presses still move five plies and the
     counter follows), an absolute jump takes the newest target, and the board
     changes at most once per frame. A non-animated load is a new position, not a
     navigation, so it applies immediately and never waits for a frame. */
  const navRef = useRef({ raf: 0, target: 0, animate: true, source: 'viewer-nav' });
  /* The ply the board actually shows, kept as of the last navigation rather than
     as of the last render. -1 until the first position is loaded. */
  const appliedPlyRef = useRef(-1);
  const navFlushRef = useRef(() => {});
  navFlushRef.current = () => {
    const nav = navRef.current;
    nav.raf = 0;
    applyNav(nav.target, nav.animate, nav.source);
  };

  /* `target` is a delta for a step and an absolute ply for a jump. While a frame
     is already waiting, steps add up and the newest jump wins; a step that opens
     a new queue counts from the ply the board is on. */
  function queueNav(target, source, isStep) {
    const nav = navRef.current;
    const pending = Boolean(nav.raf);
    const base = appliedPlyRef.current < 0 ? moveIndex : appliedPlyRef.current;
    nav.target = isStep ? (pending ? nav.target + target : base + target) : target;
    nav.animate = true;
    nav.source = source;
    if (!pending) nav.raf = requestAnimationFrame(() => navFlushRef.current());
  }

  function go(idx, animate = true, source = 'viewer-nav', isStep = false) {
    if (!animate || typeof requestAnimationFrame !== 'function') {
      if (navRef.current.raf) { cancelAnimationFrame(navRef.current.raf); navRef.current.raf = 0; }
      applyNav(idx, false, source);
      return;
    }
    queueNav(idx, source, isStep);
  }
  /* Steps are deltas so a held key accumulates correctly inside one frame; jumps
     are absolute plies and the newest one wins. */
  const stepNav = (delta, source) => go(delta, true, source, true);
  const jumpNav = (ply, source = 'viewer-nav') => go(ply, true, source);

  useEffect(() => () => {
    if (navRef.current.raf) cancelAnimationFrame(navRef.current.raf);
  }, []);

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
        if (!alive || !res) return;
        setReview(projectReview(res)); setRevState('done');
        /* a restored review is a finished one */
        if (onReviewComplete) onReviewComplete({ ref: { gameSource, gameId }, game: loaded });
      })
      .catch(() => { });
    return () => { alive = false; };
  }, [gameId, gameSource, loadAnalysis, onReviewComplete, parsed.initFen, loaded?.pgn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Keyboard: ←/→ prev/next, ↑/Home first, ↓/End last, F flip. One listener,
     always active while the card is mounted (no need to click the board).
     The steps are deltas, so a held key accumulates inside the frame it paints
     in rather than queueing one rebuild per keypress. */
  useReviewKeys({
    prev: () => stepNav(-1, 'keyboard'),
    next: () => stepNav(1, 'keyboard'),
    first: () => jumpNav(0, 'keyboard'),
    last: () => jumpNav(plies, 'keyboard'),
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

  /* How long a cold engine is given to answer the pre-flight probe. A first NNUE
     download is over 100 MB, so this cannot be a few seconds — but it does have
     to be a number, so a worker that never answers produces an error the card can
     recover from instead of a permanent "Analyzing… 0%". */
  const ENGINE_BOOT_TIMEOUT_MS = 120000;

  async function runAnalysis() {
    if (revState === 'running' || !parsed.moves.length) return;
    const token = ++revToken.current;
    setRevState('running');
    setProgress(0);
    setError(null);
    /* Explicit engine pre-flight: if Stockfish can't boot (wasm blocked / failed
       handshake) we fail fast with a clear message instead of the review pipeline
       silently hanging on its first search forever.
       The call is BOUNDED, like every other engine await in this card. It used to
       have no ceiling: a worker that accepted the command and never answered left
       the card at "Analyzing… 0%" with no error, no result and no way back to an
       idle-looking board. */
    let preWatchdog = null;
    try {
      const booted = await Promise.race([
        searchTopMoves(parsed.initFen === 'start' ? new Chess().fen() : parsed.initFen, { maxDepth: 4, multiPv: 1 })
          .then(() => null, () => ({ bootFailed: true })),
        new Promise((resolve) => { preWatchdog = setTimeout(() => resolve({ bootTimedOut: true }), ENGINE_BOOT_TIMEOUT_MS); }),
      ]);
      if (token !== revToken.current) return;
      /* A boot that timed out is still occupying a worker: abort it, or the retry
         queues behind the search that never finished. */
      if (booted && booted.bootTimedOut) stopEngineSearch();
      if (booted) {
        setRevState('error');
        setError(booted.bootTimedOut
          ? 'The chess engine is slow to start — it may still be downloading. Try again in a moment.'
          : 'The chess engine could not start (Stockfish WebAssembly failed to load or boot). Try again in a moment.');
        return;
      }
    } catch {
      /* Nothing here is expected to throw — the pre-flight rejection is handled
         above — but a synchronous surprise must still land the card on `error`,
         not leave it reading "running" forever. */
      if (token === revToken.current) {
        setRevState('error');
        setError('The chess engine could not start (Stockfish WebAssembly failed to load or boot). Try again in a moment.');
      }
    } finally {
      window.clearTimeout(preWatchdog);
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
      /* Every move classified and the verdicts are on screen — this is the
         moment "reviewed" becomes true, not the moment the card was opened. */
      if (onReviewComplete) onReviewComplete({ ref: { gameSource, gameId }, game: gameData });
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
  /* The last-move highlight is part of the position table, so the board marker
     cannot drift from the ply showing: both come from `positions[moveIndex]`.
     Ply 0 has no move, and the table's entries are the only source — no state
     that has to be set in step with navigation. */
  const lastMove = positions[moveIndex]?.lastMove || null;
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
     its suggestion is about the board being looked at. Only the best move is
     drawn: the 2nd and 3rd engine preferences are not alternatives a student
     should read as "also fine".
     Recomputed from `moveIndex` alone, so an arrow can never outlive the
     position that produced it — and it is empty at the last ply, where there is
     no next move to point at. */
  const TOP_LINE_COLOR = 'rgba(0, 128, 0, 1)';
  const lineArrows = useMemo(() => {
    const row = verdicts && moveIndex < verdicts.length ? verdicts[moveIndex] : null;
    if (!row) return [];
    /* A ply whose search failed still records the best UCI the engine did see,
       so the arrow comes from that instead of disappearing from a position that
       has an answer. */
    const best = Array.isArray(row.lines) && row.lines[0] ? row.lines[0] : null;
    const uci = (best && best.uci) || row.bestUci || null;
    const from = (best && best.from) || (uci ? uci.slice(0, 2) : null);
    const to = (best && best.to) || (uci ? uci.slice(2, 4) : null);
    if (!from || !to || from === to) return [];
    return [{ from, to, color: TOP_LINE_COLOR }];
  }, [verdicts, moveIndex]);

  /* The score sheet's content, built once per game + analysis. Each row's cells
     keep a stable identity so `ScoreRow`'s memo can hold: navigation changes only
     which cell is active, never what any cell says. The row renders its own
     glyph and grade class from the verdict, exactly as the inline version did —
     what the memo buys is that this data (and the SAN strings) are not rebuilt
     for all 75 rows on every step. */
  const sheetRows = useMemo(() => {
    const pairs = Math.ceil(parsed.moves.length / 2);
    const out = new Array(pairs);
    for (let i = 0; i < pairs; i += 1) {
      const cells = [0, 1].map((off) => {
        const idx = i * 2 + off;
        if (idx >= parsed.moves.length) return null;
        const v = verdicts ? verdicts[idx] : null;
        return { ply: idx + 1, san: parsed.moves[idx], verdict: v ? v.verdict : null };
      });
      out[i] = { num: i + 1, cells };
    }
    return out;
  }, [parsed.moves, verdicts]);

  /* The row's tap handler must not change identity on every render, or the memo
     above is pointless. The ref keeps the closure pointing at the CURRENT
     orientation/review without making `onCell` itself unstable. */
  const jumpRef = useRef(null);
  jumpRef.current = (ply) => jumpNav(ply, 'score-sheet');
  const onCell = useCallback((ply) => jumpRef.current(ply), []);

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

  /* Compact player rows that sit immediately above and below the board on a
     phone, matching the board's orientation. They are hidden on desktop, where
     the score sheet already names both players. */
  const topSide = orientation === 'white' ? 'black' : 'white';
  const bottomSide = orientation === 'white' ? 'white' : 'black';
  const renderSeat = (side, pos) => {
    const name = side === 'white' ? whiteLabel : blackLabel;
    const accValue = accuracyForSide(side);
    return (
      <div className={`cp-seat cp-seat--${pos}`}>
        <span className="cp-seat-dot" aria-hidden="true">{side === 'white' ? '⚪' : '⚫'}</span>
        <span className="cp-seat-name" title={name}>{name}</span>
        {accValue != null && <span className="cp-seat-acc">{accValue}%</span>}
        {pos === 'top' && isMobileBoard && (
          <span className="cp-seat-eval" title="Evaluation">{formatEvalScore(evalCp, evalMate)}</span>
        )}
      </div>
    );
  };

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
          <div className="cp-viewer-board">
            {renderSeat(topSide, 'top')}
            <div className="cp-viewer-board-row">
              <div className="cp-board-fit">
                {/* The shared Game Review bar, immediately left of the board and
                    exactly one square-area tall. On a phone it becomes a thin
                    10px strip without its internal label — the score moves to
                    the compact chip in the top seat row — so the board keeps the
                    full screen width. */}
                <EvalBar
                  evaluation={evalCp}
                  mate={evalMate}
                  orientation={orientation}
                  height="auto"
                  width={isMobileBoard ? 10 : undefined}
                  showLabel={!isMobileBoard}
                />
                <ResponsiveBoard
                  className="cp-board-responsive"
                  maxWidth={560}
                  game={boardRef.current}
                  mode="analysis"
                  orientation={orientation}
                  interactive={false}
                  customArrows={lineArrows}
                  /* Stepping through a game is reading, not watching: the glide
                     is capped at 160 ms so the board is already on the next move
                     when the thumb is, whatever the saved animation preset says.
                     A player who chose "no animation" still gets none. */
                  maxMoveMs={160}
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
            {renderSeat(bottomSide, 'bottom')}

            <div className="cp-nav">
              <button className="cp-nav-btn" disabled={moveIndex === 0} onClick={() => jumpNav(0)} title="Start">⏮</button>
              <button className="cp-nav-btn" disabled={moveIndex === 0} onClick={() => stepNav(-1)} title="Previous">◀</button>
              <span className="cp-nav-count">{moveIndex} / {plies}</span>
              <button className="cp-nav-btn" disabled={moveIndex >= plies} onClick={() => stepNav(1)} title="Next">▶</button>
              <button className="cp-nav-btn" disabled={moveIndex >= plies} onClick={() => jumpNav(plies)} title="End">⏭</button>
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
                <button
                  className="cp-nav-btn cp-sheet-toggle"
                  aria-expanded={sheetOpen}
                  aria-controls="cp-score-body"
                  onClick={() => setSheetOpen((v) => !v)}
                  title={sheetOpen ? 'Hide the score sheet' : 'Show the score sheet'}
                >
                  {sheetOpen ? '▾' : '▸'}
                </button>
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

            {sheetOpen && (
              <>
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
            <div className="cp-score" id="cp-score-body" role="list" aria-label="Game moves" ref={scoreRef}>
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
                  {sheetRows.map(({ num, cells }, i) => (
                    <ScoreRow
                      key={i}
                      num={num}
                      cells={cells}
                      onCell={onCell}
                      activeWhite={cells[0]?.ply === moveIndex}
                      activeBlack={cells[1]?.ply === moveIndex}
                    />
                  ))}
                </>
              )}
            </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  , document.body);
}