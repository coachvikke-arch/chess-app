import { useEffect, useMemo, useRef, useState, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import EvalBar from './EvalBar';
import VariationBoard from './variation/VariationBoard';
import VariationMoveList from './variation/VariationMoveList';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import useMediaQuery from '../hooks/useMediaQuery';
import { formatEvalScore } from '../lib/evalDisplay';
import { parsePgn, formatDate } from '../utils/pgnTools';
import { describeGameEnd } from '../lib/chessReplay';
import { reviewMetaFor } from '../utils/gameReview';
import { CANONICAL_ANALYSIS_VERSION, getCanonicalAnalysis } from '../utils/canonicalAnalysis';
import { persistSigmaMoves, canPersist } from '../utils/sigmaPersist';
import { stopEngineSearch, searchTopMoves, warmEngine as warmReviewEngine } from '../utils/nnueEngine';
import useCopyFullPgn from '../hooks/useCopyPgn';
import useVariationTree, { VARIATION_STORAGE_PREFIX } from '../hooks/useVariationTree';
import useVariationLiveEval from '../hooks/useVariationLiveEval';
import { classifySideMove, projectVariationRow } from '../utils/reviewSideLine';
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
  /* The shared copy path adds the app-wide "Copied!" toast; the button keeps
     its own brief label change on top of it. */
  const copyFullPgn = useCopyFullPgn();
  const copy = async () => {
    const ok = await copyFullPgn(buildGamePgn({ game, moves, initialFen }));
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
  /* ── the move tree ────────────────────────────────────────────────────────
     The game's own moves are the immutable mainline; anything the user tries
     becomes a branch beside them (see utils/variationTree.js). Navigation is a
     pointer read, so stepping through a 156-ply game costs an object lookup
     instead of the old replay-per-press. The mainline can never be edited,
     truncated or re-parented from here — variation actions only ever add,
     delete their own branch, or move the pointer. */
  const startPly = useMemo(() => {
    const total = parsed.moves.length;
    if (initialMoveIndex == null) return total;
    const i = Math.floor(Number(initialMoveIndex));
    if (!Number.isFinite(i)) return total;
    return Math.max(0, Math.min(total, i));
  }, [parsed.moves.length, initialMoveIndex]);
  const [orientation, setOrientation] = useState('white');
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
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

  /* This user's own branches for this game. localStorage is the fallback the
     brief allows: the imported game row is NEVER written to. */
  const variationKey = useMemo(() => {
    if (gameId == null) return null;
    let uid = 'anon';
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (u && u.id != null) uid = String(u.id);
    } catch { /* anonymous viewer */ }
    return `${VARIATION_STORAGE_PREFIX}:card:${uid}:${gameSource}:${gameId}`;
  }, [gameId, gameSource]);

  const reviewRef = useRef(null);
  reviewRef.current = review;
  const treeApiRef = useRef(null);
  const gradingRef = useRef(new Set());
  const gradeRef = useRef(null);

  /* Every pointer move that lands on a real move plays that move's effect on
     THIS board. A branch played on the board already played its own (ChessBoard
     fires it for a user move), so it is skipped here. */
  const onTreeChange = useCallback((next, meta) => {
    if (!meta) return;
    if (meta.type === 'game-loaded') { clearMoveEffects('viewer-nav'); return; }
    if (meta.type !== 'navigate' && meta.type !== 'branch') return;
    const node = meta.node;
    const boardPlayed = meta.type === 'branch' && meta.source === 'variation-board';
    if (node && node.ply > 0 && !boardPlayed) {
      const row = node.row || (node.isMainline ? reviewRef.current?.verdicts?.[node.ply - 1] : null);
      try {
        playEffectForMove(node.ply, meta.source || 'viewer-nav', {
          game: new Chess(node.fen),
          move: node,
          verdict: row ? row.verdict : null,
          sacrifice: Boolean(row && row.sacrifice),
          orientation: orientationRef.current,
          boardId: effectHostId,
        });
      } catch { /* an effect must never block navigation */ }
    }
    if (meta.type === 'branch') gradeRef.current?.(meta);
  }, [effectHostId]);

  const tree = useVariationTree(parsed.moves, {
    initialFen: parsed.initFen,
    initialPly: startPly,
    storageKey: variationKey,
    /* A card opened ON a specific move (a Brilliant) starts there even when a
       saved exploration exists; otherwise reopening resumes that exploration. */
    restorePointer: initialMoveIndex == null,
    onLocalChange: onTreeChange,
  });
  treeApiRef.current = tree;

  /* Grade a NEW variation move with the same canonical one-move pipeline Game
     Review uses, so its badge matches what the mainline would get. Only when a
     review already exists — without one the mainline carries no badges either. */
  gradeRef.current = (meta) => {
    if (!reviewRef.current) return;
    const { node, parent } = meta;
    if (!node || !parent || gradingRef.current.has(node.id)) return;
    gradingRef.current.add(node.id);
    classifySideMove(parent.fen, { san: node.san, ply: node.ply })
      .then((row) => { if (row) treeApiRef.current?.setNodeGrade(node.id, projectVariationRow(row)); })
      .catch(() => { /* no verdict is a valid outcome */ })
      .finally(() => { gradingRef.current.delete(node.id); });
  };

  /* Landing on a saved branch that was never graded: classify it on arrival —
     one move at a time — instead of burning the engine on every saved branch
     the moment the card opens. */
  useEffect(() => {
    const node = tree.current;
    if (!review || !node || node.isMainline || node.row) return;
    const parent = tree.nodes[node.parentId];
    if (parent) gradeRef.current?.({ node, parent });
  }, [tree.currentId, tree.nodes, review]);

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

  /* Navigation needs no effect: the tree already rebuilt and re-pointed when
     the game (or the requested move) changed, and hydration loaded the saved
     branches in the same commit. */

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

  /* Keyboard: ←/→ walk the CURRENT line, ↑/↓ switch between the moves played
     from the same position (the two sides of a branch), Home/End the ends, F
     flips. The tree commits synchronously, so a held key accumulates instead of
     queueing one rebuild per press. */
  useReviewKeys({
    prev: () => tree.goBack('keyboard'),
    next: () => tree.goForward('keyboard'),
    siblingPrev: () => tree.goSibling(-1, 'keyboard'),
    siblingNext: () => tree.goSibling(1, 'keyboard'),
    first: () => tree.goToStart('keyboard'),
    last: () => tree.goToEnd('keyboard'),
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  });

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
  const plies = Math.max(0, tree.mainlineIds.length - 1);
  const moveIndex = tree.currentPly;
  /* The last-move marker and the position both come from the node the pointer
     is on, so they cannot drift. */
  const lastMove = tree.currentLastMove;
  const myColor = gameData.my_color || 'white';
  /* Canonical accuracy only: it always ships with the review and always
     describes the ORIGINAL game, never a variation. */
  const accuracyForSide = (side) => review?.accuracy?.[side] ?? null;
  const mineAccuracy = accuracyForSide(myColor);
  const oppAccuracy = accuracyForSide(myColor === 'white' ? 'black' : 'white');

  /* A mainline node's verdict is the stored row for that ply; a variation node
     carries its own one-move row once it has been graded. */
  const rowOf = useCallback((n) => {
    if (!n || !n.isMainline) return null;
    return verdicts?.[n.ply - 1] || null;
  }, [verdicts]);
  const currentRow = useMemo(() => {
    const n = tree.current;
    if (!n || n.ply === 0) return null;
    return n.row || rowOf(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.currentId, tree.nodes, rowOf]);
  const curVerdict = currentRow?.verdict || null;

  /* Off the original line the stored review says nothing about this position,
     so the bar and the arrow come from a live search of the node on screen.
     They are never mixed into accuracy or the score sheet. */
  const liveEval = useVariationLiveEval(tree.currentFen, {
    enabled: !tree.isOnMainline && revState !== 'running',
  });
  const evalCp = tree.isOnMainline ? (currentRow?.evalAfter ?? 0) : (liveEval?.score ?? 0);
  const evalMate = tree.isOnMainline ? (currentRow?.mateAfter ?? null) : (liveEval?.mate ?? null);

  const moveBadge = useMemo(() => {
    const v = currentRow;
    if (!v || !v.uci || v.uci.length < 4) return null;
    const to = v.uci.slice(2, 4);
    return {
      verdict: v.verdict,
      sacrifice: Boolean(v.sacrifice),
      square: to,
      file: to.charCodeAt(0) - 97,   // 0-7
      rank: Number(to[1]) - 1,       // 0-7
    };
  }, [currentRow]);

  /* ── board overlay: the engine's BEST move, one arrow ──
     On the original line, row `moveIndex` is the move that comes NEXT from the
     position on screen. In a variation, the live search answers for the node
     itself. Only the best move is drawn: the 2nd and 3rd engine preferences are
     not alternatives a student should read as "also fine". */
  const TOP_LINE_COLOR = 'rgba(0, 128, 0, 1)';
  const lineArrows = useMemo(() => {
    let uci = null;
    let from = null;
    let to = null;
    if (tree.isOnMainline) {
      const row = verdicts && moveIndex < verdicts.length ? verdicts[moveIndex] : null;
      if (!row) return [];
      /* A ply whose search failed still records the best UCI the engine did see,
         so the arrow comes from that instead of disappearing. */
      const best = Array.isArray(row.lines) && row.lines[0] ? row.lines[0] : null;
      uci = (best && best.uci) || row.bestUci || null;
      from = (best && best.from) || (uci ? uci.slice(0, 2) : null);
      to = (best && best.to) || (uci ? uci.slice(2, 4) : null);
    } else if (liveEval?.bestUci) {
      uci = liveEval.bestUci;
      from = uci.slice(0, 2);
      to = uci.slice(2, 4);
    }
    if (!from || !to || from === to) return [];
    return [{ from, to, color: TOP_LINE_COLOR }];
  }, [verdicts, moveIndex, tree.isOnMainline, liveEval]);

  const resetVariations = () => {
    if (!window.confirm('Reset to the original game line? This removes every variation and any promoted view.')) return;
    tree.resetVariations();
  };

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
                {/* The board is INTERACTIVE: dragging or clicking a legal move
                    either steps to that move when it already exists on this
                    line, or branches beside it. The original game is never
                    overwritten, so there is nothing destructive to guard. */}
                <VariationBoard
                  className="cp-board-responsive"
                  maxWidth={560}
                  tree={tree}
                  mode="analysis"
                  orientation={orientation}
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
                  /* Canonical verdict colour for the selected move's destination
                     square — the same mapping the review board uses. */
                  reviewVerdictColor={reviewMetaFor(curVerdict)?.color || null}
                />
              </div>
            </div>
            {renderSeat(bottomSide, 'bottom')}

            <div className="cp-nav">
              <button className="cp-nav-btn" disabled={tree.isAtStart} onClick={() => tree.goToStart('viewer-nav')} title="Start">⏮</button>
              <button className="cp-nav-btn" disabled={tree.isAtStart} onClick={() => tree.goBack('viewer-nav')} title="Previous">◀</button>
              <span className="cp-nav-count">{moveIndex} / {plies}</span>
              <button className="cp-nav-btn" disabled={!tree.hasForward} onClick={() => tree.goForward('viewer-nav')} title="Next">▶</button>
              <button className="cp-nav-btn" disabled={!tree.hasForward} onClick={() => tree.goToEnd('viewer-nav')} title="End">⏭</button>
              {/* The way out of a variation, always reachable from the board —
                  even when the score sheet is folded away on a phone. */}
              {!tree.isOnMainline && (
                <button
                  className="cp-nav-btn cp-nav-orig"
                  onClick={() => tree.returnToMainline('viewer-nav')}
                  title="Leave this variation and return to the original game line"
                >← Original</button>
              )}
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
                {tree.hasVariations && (
                  <button
                    className="cp-nav-btn"
                    onClick={resetVariations}
                    title="Remove every variation and restore the original game"
                    aria-label="Reset to the original game line"
                  >↺</button>
                )}
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
            <div className="cp-score" id="cp-score-body" aria-label="Game moves">
              {/* The SHARED list: the original game in the ordinary grid, and
                  every try beside it as a collapsible, coloured block. The game
                  line cannot be lost because nothing here replaces it. */}
              <VariationMoveList
                tree={tree}
                headless
                title="Moves"
                whiteName={whiteLabel}
                blackName={blackLabel}
                rowOf={rowOf}
                scrollHost=".cp-score"
                emptyText="No moves recorded for this game."
              />
            </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  , document.body);
}