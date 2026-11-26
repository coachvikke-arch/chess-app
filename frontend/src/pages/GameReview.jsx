import Portal from '../components/Portal';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { formatEvalScore } from '../lib/evalDisplay';
import useVisibleEffectHost from '../hooks/useVisibleEffectHost';
import SetupBoardButton from '../components/SetupBoardButton';
import { Page } from '../components/ui';
import { isAdminRole } from '../utils/roles';
import { playSound } from '../utils/sound';
import { stopEngineSearch, warmEngine as warmReviewEngine, resetReviewEngine, reviewEngineStatus } from '../utils/nnueEngine';
import { stopEngineSearch as stopLiteSearch, searchTopMoves as searchTopMovesLite, warmEngine as warmLiteEngine } from '../utils/engine';
import { classifySideMove } from '../utils/reviewSideLine';
import { extractPgnFen } from '../utils/canonicalAnalysis';
import { sanitizeFen } from '../utils/fen';
import { copyText } from '../utils/clipboard';
import { buildFullPgn, buildRowPgn } from '../utils/gamePgn';
import GameViewerCard from '../components/GameViewerCard';
import VariationBoard from '../components/variation/VariationBoard';
import VariationMoveList from '../components/variation/VariationMoveList';
import useVariationTree from '../hooks/useVariationTree';
import { clearMoveEffects } from '../effects/moveEffect';
import { fetchGame, fetchAnalysis, saveAnalysis } from '../services/chessProfiles';
import { resolveSigmaGame as resolveSigmaGameRow, sigmaGameRef } from '../utils/gameIdentity';
import { pgnPlayerName } from '../lib/scoreSheet';
import { LIVE_ANALYSIS_DEPTH, LIVE_ANALYSIS_MULTIPV } from '../utils/reviewConfig';
import EvalBar from '../components/EvalBar';
import { REVIEW_META, REVIEW_ORDER, reviewMetaFor, reviewCounts, SIGMA_TYPES_IN_PRIORITY_ORDER } from '../utils/gameReview';
import { SIGMA_TYPE_META, isSigmaVerdict } from '../utils/sigmaType';
import { persistSigmaMoves, canPersist } from '../utils/sigmaPersist';
import SigmaMoves from '../components/SigmaMoves';
import { startReview, cancelReview, attachReview, activeReviewId, finishedReview, hasActiveReview } from '../utils/reviewRunner';
import { RankBadge } from '../components/RankBadges';
import {
  fetchLibrary,
  createFolder as apiCreateFolder,
  createItem as apiCreateItem,
  validateFolderName,
  getRootFolders,
} from '../utils/libraryApi';
import { buildPuzzlePgn } from '../utils/puzzlePgn';
import SearchCaissa from '../components/SearchCaissa';
import GameHistory from './GameHistory';
import { pgnHasMoves } from '../utils/gamePgn';
import api from '../services/api';
import { useReviewKeys } from '../hooks/useReviewKeys';
import { playEffectForMove } from '../effects/moveEffect/playForMove';
import { useFullHeight } from '../context/FullHeightContext';
import Button from '../components/Button';
import { BOT } from '../components/bot/botTriggers';

/* ------------------------------- helpers ---------------------------------- */

/* PGN [Date] is "YYYY.MM.DD" with a trailing move number ("2026.01.05 10:32:00"),
   which is not a Date.parse input on every engine. Normalised to ISO so the
   Sigma date filters compare a real timestamp; an unparseable tag yields null
   rather than "now", which would file an old game in today's window. */
function normalisePgnDate(tag) {
  const m = String(tag).trim().match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}T00:00:00.000Z`;
}

function rebuild(init, list) {
  /* Strip castling rights the position does not support before chess.js sees
     the FEN. Its move generation throws (BigInt Zobrist bug, jhlywa/chess.js#577)
     on a FEN like "... w KQkq ..." when no rook sits on its home square — that
     throw escapes the per-move catch below from the initial position and crashed
     the whole page. sanitizeFen leaves real positions untouched. */
  const safeInit = init === 'start' ? 'start' : sanitizeFen(init);
  const g = new Chess(safeInit === 'start' ? undefined : safeInit);
  for (const m of list) {
    try { g.move(m); } catch { break; }
  }
  return g;
}

function resultText(g) {
  /* Every call below runs move generation, which chess.js 1.4.0 can throw on for
     a degenerate position. This is only a text label — never let it take the
     page down; fall back to no label. */
  try {
    if (g.isCheckmate())  return g.turn() === 'w' ? 'Black wins by checkmate' : 'White wins by checkmate';
    if (g.isStalemate())  return 'Draw — stalemate';
    if (g.isThreefoldRepetition()) return 'Draw — threefold repetition';
    if (g.isInsufficientMaterial()) return 'Draw — insufficient material';
    if (g.isDraw())       return 'Draw';
  } catch { /* unanalysable position — no result label */ }
  return '';
}

/* stable id for a game+position — matches reviewRunner sessions so a review
   already grinding in the background is resumed rather than restarted */
function sessionIdFor(fenInit, sanList) {
  return `${fenInit}::${(sanList || []).join('|')}`;
}

const STATE = {
  empty: 'empty',
  loaded: 'loaded',
  analyzing: 'analyzing',
  done: 'done',
};

/* ── review session persistence ──
   The whole in-progress review (position, moves, results, cursor, input) is
   kept in localStorage so refreshing the page or leaving the section doesn't
   wipe it. A manual ✕ Vanish button clears it explicitly.
   SESSION_VERSION is bumped whenever the review logic changes (New Santo
   thresholds, classification rules, engine pipeline swap…): a session saved
   by an older logic version is NOT restored — the game gets re-analyzed with
   the current logic instead of showing stale verdicts.

   THE KEY IS SCOPED PER USER. localStorage is per-BROWSER, not per-account, so
   a single shared key meant that whoever used the app last owned the session:
   sign in as a different user (e.g. a coach after a superadmin on the same
   machine) and their Game Review opened showing ANOTHER person's game, moves
   and verdict badges — and persisting your own review overwrote theirs. Each
   user now gets their own slot, so every account keeps a separate review.

   `id` is preferred, but fall back through username/email and finally to a
   distinct 'anon' bucket so a signed-out visitor can never read a named user's
   session (and vice-versa). */
const SESSION_VERSION = 2;
const STORAGE_PREFIX = 'game-review-session-v2';
const storageKeyFor = (user) => {
  const id = user?.id ?? user?.user_id ?? user?.userId
    ?? user?.username ?? user?.email ?? 'anon';
  return `${STORAGE_PREFIX}:${id}`;
};

/* ================================ component ================================ */

export default function GameReview() {
  /* The page is fitted to the viewport: only the side panel and the board's
     inner lists scroll. Registering with the shell gives the route the whole
     content area (no shell padding, no page scrollbar). */
  const { requestFullHeight } = useFullHeight();
  useEffect(() => {
    requestFullHeight(true);
    return () => requestFullHeight(false);
  }, [requestFullHeight]);

  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = location.pathname.startsWith('/admin');
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(`${isAdmin ? '/admin' : '/student'}/dashboard`);
  };
  /* persistence: a restored review is marked so its auto-review is skipped */
  const restoredFromStorage = useRef(false);
  /* which background session (reviewRunner) this component is attached to */
  const sessionIdRef = useRef(null);
  /* moves played by hand on an empty board are the player exploring — do NOT
     auto-start the engine review for them; they press "Analyze" when ready */
  const boardFlowed = useRef(false);

  const [initialFen, setInitialFen] = useState('start');
  const [moves, setMoves] = useState([]);
  /* A v2 session stored only a mainline ply; a restored numeric cursor is
     handed to the tree as its starting pointer. v3 sessions carry the tree
     itself, so this is cleared. */
  const [restorePly, setRestorePly] = useState(null);
  const [orientation, setOrientation] = useState('white');
  const [movesOpen, setMovesOpen] = useState(true);
  /* which panel is showing beside the board: Moves | Load a game | Review */
  const [sideTab, setSideTab] = useState('moves');

  const [state, setState] = useState(STATE.empty);
  const [progress, setProgress] = useState(0);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [pgnText, setPgnText] = useState('');
  /* The PGN the board was loaded FROM, headers included. The export rebuilds the
     move text from the board but takes Event/Site/Date/players/result/Source
     from here, so a copied or shared game keeps its identity. */
  const [sourcePgn, setSourcePgn] = useState('');
  const [loadOpen, setLoadOpen] = useState(true);
  const [toast, setToast] = useState('');   // brief "Copied!" confirmation
  const [gameId, setGameId] = useState(null); // optional online game session id (?id=)
  /* Who played each side, for the score-sheet header. The PGN this page loads
     carries no [White]/[Black] tags (chess.js writes the movetext only), so the
     names have to arrive from the history row that opened the game. Left empty
     when the PGN came from a URL or the paste box - the header then falls back
     to "White"/"Black" rather than inventing a name. */
  const [players, setPlayers] = useState({ white: '', black: '' });
  /* Where this game came from, so its Sigmas can be filed against a real row:
       gameSource — 'chess_profile' | 'online' | 'computer' | 'tournament' | null
       gameRefId  — the id in that source's table, or null
       playedAt   — when the GAME was played (the date filters bucket by this)
     A pasted PGN or a bare FEN has none of these, and that is fine: its Sigmas
     stay in the review panel only. */
  const [gameOrigin, setGameOrigin] = useState({ gameSource: null, gameRefId: null, playedAt: null });

  /* ── advanced engine (live analysis) ──
     Toggled from the board toolbar (icon next to Flip). Runs a fixed-depth
     Stockfish search on the current position (eval bar + best-move hint) and
     grades every variation move on the fly. Preference persists per user
     (localStorage `gr-engine-pref`). */
  const [engineOn, setEngineOn] = useState(() => {
    try { return localStorage.getItem('gr-engine-pref') === '1'; } catch { return false; }
  });
  const [liveEval, setLiveEval] = useState(null);      // { pawns, score, mate, depth, bestUci, fen }
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineDiag, setEngineDiag] = useState('');      // last engine health note (boot failure, blocked worker)
  const engineToken = useRef(0);

  /* ── the move tree ──
     ONE model for the whole page (utils/variationTree): the game's own moves
     are the immutable mainline, every try becomes a branch beside them, and the
     cursor is a pointer. The review's verdict rows stay keyed to MAINLINE
     plies, so accuracy, the summary and the score sheet can never be affected
     by a variation — a variation node carries its own one-move row instead. */
  const [savedVariation, setSavedVariation] = useState(null);
  /* The review board's effect host id. Named, so every effect this page
     triggers (a step, a move-list click, a variation move) lands on the board
     the user is looking at. */
  const reviewBoardHostId = useId();
  useVisibleEffectHost(reviewBoardHostId);
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const engineOnRef = useRef(engineOn);
  engineOnRef.current = engineOn;
  const treeApiRef = useRef(null);
  const treeRef = useRef(null);
  const gradingRef = useRef(new Set());
  const gradeRef = useRef(null);

  /* Every pointer move that lands on a real move plays that move's effect on
     THIS board. A move played on the board already fired its own effect, so it
     is skipped here. */
  const onTreeChange = useCallback((next, meta) => {
    if (!meta) return;
    if (meta.type === 'game-loaded') { clearMoveEffects('review-nav'); return; }
    if (meta.type !== 'navigate' && meta.type !== 'branch') return;
    /* The first move on an empty board becomes the game line (see `onTreeMove`),
       so there is nothing to grade or flag as a variation. */
    if (movesRef.current.length === 0) return;
    const node = meta.node;
    const boardPlayed = meta.type === 'branch' && meta.source === 'variation-board';
    if (node && node.ply > 0 && !boardPlayed) {
      const row = node.row || (node.isMainline ? reviewRef.current?.moves?.[node.ply - 1] : null);
      try {
        playEffectForMove(node.ply, meta.source || 'review-nav', {
          game: new Chess(node.fen),
          move: node,
          verdict: row ? row.verdict : null,
          sacrifice: Boolean(row && row.sacrifice),
          orientation: orientationRef.current,
          boardId: reviewBoardHostId,
        });
      } catch { /* an effect must never block navigation */ }
    }
    if (meta.type === 'branch') gradeRef.current?.(meta);
  }, [reviewBoardHostId]);

  const tree = useVariationTree(moves, {
    initialFen,
    initialPly: restorePly == null ? 'end' : restorePly,
    loadSaved: savedVariation,
    onLocalChange: onTreeChange,
  });
  treeApiRef.current = tree;
  treeRef.current = tree;

  /* Grade a NEW variation move with the same canonical one-move pipeline the
     review uses, so its badge matches the mainline's. The RAW row is stored
     (mover's point of view) — this page's eval bar signs it back itself. */
  gradeRef.current = (meta) => {
    if (!engineOnRef.current) return;
    const { node, parent } = meta || {};
    if (!node || !parent || node.isMainline || gradingRef.current.has(node.id)) return;
    gradingRef.current.add(node.id);
    classifySideMove(parent.fen, { san: node.san, ply: node.ply })
      .then((row) => { if (row) treeApiRef.current?.setNodeGrade(node.id, row); })
      .catch(() => { /* no verdict is a valid outcome */ })
      .finally(() => { gradingRef.current.delete(node.id); });
  };

  /* A move played on an EMPTY board IS the game line (free play / setup
     position), so it is appended to the mainline instead of branching off
     nothing. The hook rebuilds its mainline from `moves`, which drops the
     provisional branch and leaves the cursor at the end. */
  const onTreeMove = useCallback((result) => {
    if (!result || result.illegal || !result.created) return;
    if (movesRef.current.length > 0) return;
    boardFlowed.current = true;
    setMoves([result.node.san]);
    if (reviewRef.current) { setReview(null); setState(STATE.loaded); }
  }, []);

  /* Landing on a saved branch that was never graded: classify it on arrival —
     one move at a time — instead of burning the engine on every saved branch
     the moment the page opens. */
  useEffect(() => {
    if (!engineOn) return;
    const node = tree.current;
    if (!node || node.isMainline || node.row) return;
    const parent = tree.nodes[node.parentId];
    if (parent) gradeRef.current?.({ node, parent });
  }, [tree.currentId, tree.nodes, engineOn]);

  /* session-persistence throttling (see the persist effect below): the last
     written significant payload, and the last progress milestone written. */
  const lastPersistedSig = useRef(null);
  const lastProgressBucket = useRef(-1);

  /* ── analysis progress read-out (elapsed + estimated time left) ──
     Stockfish review is opaque: the bar moves but nothing says whether a
     40-move game is 20 seconds or 10 minutes away. Sampled once a second
     (a timer, not a render per engine callback) so it costs nothing next to
     the search, and it stops as soon as the run finishes. */
  const [analysisTick, setAnalysisTick] = useState(0);
  const analysisStartRef = useRef(null);
  const analysisProgressRef = useRef(0);
  const analysisTotalRef = useRef(0);
  useEffect(() => {
    if (state !== STATE.analyzing) return undefined;
    const id = setInterval(() => setAnalysisTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state]);
  useEffect(() => { analysisProgressRef.current = progress || 0; }, [progress]);
  useEffect(() => { analysisTotalRef.current = moves.length; }, [moves.length]);
  useEffect(() => {
    if (state === STATE.analyzing) analysisStartRef.current = analysisStartRef.current || Date.now();
    else analysisStartRef.current = null;
  }, [state]);

  const analysisElapsed = (() => {
    if (!analysisTick || !analysisStartRef.current) return '';
    const s = Math.round((Date.now() - analysisStartRef.current) / 1000);
    if (s < 1) return '';
    return s < 60 ? `${s}s elapsed` : `${Math.floor(s / 60)}m ${s % 60}s elapsed`;
  })();
  const analysisEta = (() => {
    const done = analysisProgressRef.current;
    const total = analysisTotalRef.current;
    if (!analysisStartRef.current || done < 3 || done >= 100 || !total) return '';
    const perPly = (Date.now() - analysisStartRef.current) / (done / 100);
    const left = Math.round(perPly * (1 - done / 100) / 1000);
    if (left < 1) return '';
    return left < 60 ? `${left}s` : `${Math.round(left / 60)} min`;
  })();

  /* ── board setup entry (shared SetupBoardButton) + admin-only Save ── */
  const { user: authUser, loading: authLoading } = useAuth();
  const showSetupButton = isAdminRole(authUser?.role);

  /* ── per-user session storage key ──
     Read once per render from the signed-in user. `null` while auth is still
     resolving would map to the 'anon' bucket, so the restore effect below waits
     for `authLoading` to clear — otherwise a fast refresh could read (or worse,
     write) the anonymous slot before the real user is known. */
  const storageKey = storageKeyFor(authUser);
  /* The identity the currently-restored session belongs to. Guards the persist
     effect: after a logout/login switch the key changes, and we must not flush
     the previous user's on-screen review into the newly signed-in user's slot. */
  const sessionUserRef = useRef(storageKey);

  /* ── save to folder ──
     The Library is server-backed and SHARED by every admin + the superadmin,
     so the folder picker here lists the same folders the Library page shows
     (utils/libraryApi.js). Saving appends a 'pgn' (or, when the solved line is
     empty, a 'fen') item to the chosen folder, where it appears for everyone. */
  const { showToast: notify } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveFolders, setSaveFolders] = useState([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderError, setNewFolderError] = useState('');

  /* Whose Sigma list the tab shows. Null = the signed-in player's own, which is
   what a student always gets. A coach can pass ?userId= to inspect one of their
   students; the API refuses anyone unlinked, so this cannot widen access. */
  const sigmaUserId = (() => {
    const raw = new URLSearchParams(window.location.search).get('userId');
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  })();

  /* ─── tab: the analysis board, or the game list that feeds it ──
     Game History used to be its own page/sidebar entry. It is now a tab here,
     because the list is only useful as a picker FOR this board — clicking a row
     loads that PGN straight into the Review tab. Kept in the URL (?tab=) so the
     tab survives a refresh and old /game-history links can redirect here. */
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'history' || t === 'sigma' ? t : 'review';
  });

  /* Every non-default tab is written to the URL so a refresh — or a shared link —
     reopens the same screen instead of the analysis board. 'review' is the
     default, so its param is removed rather than set. */
  const switchTab = (next) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'review') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState({}, '', url);
  };

  /* ─── load from URL (?pgn=… or ?fen=…) ── */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    /* a ?pgn= link is an explicit "show me this game" — always land on Review */
    if (params.get('pgn') || params.get('fen')) setTab('review');
    else if (params.get('tab') === 'history' || params.get('tab') === 'sigma') setTab(params.get('tab'));
    const pgn = params.get('pgn');
    const fenParam = params.get('fen');
    const idParam = params.get('id');
    const srcParam = params.get('src');
    setGameId(idParam || null);
    /* `?id=` is the online-game session carried over from AnalysisBoard, and
       `?src=` says which table it lives in. Together they are the game's
       origin, so a review opened this way can file its Sigmas against that row
       - without them the origin stayed empty and the save was skipped. */
    const origin = canPersist(srcParam, idParam)
      ? { gameSource: srcParam, gameRefId: Number(idParam), playedAt: null }
      : undefined;
    /* Prefer a PGN that actually has moves. Header-only PGNs (abandoned /
       aborted games, header-only imports) are valid links but carry no game to
       review, so they fall through to the saved final position instead of
       showing "That PGN has no moves to review." */
    if (pgn && pgnHasMoves(pgn)) loadPgnText(pgn, undefined, origin);
    else if (fenParam) loadFenText(fenParam);
    else if (pgn) loadPgnText(pgn, undefined, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    return () => {
      stopLiteSearch();
      /* keep the heavy review engine alive while a review is still grinding in
         the background — it must continue across section switches */
      if (!hasActiveReview()) stopEngineSearch();
    };
  }, []);

  /* ─── pre-boot BOTH engine pools in the background.
         LITE (~7 MB, loads in a blink) backs the "Advanced Engine" bar.
         FULL NNUE (~99 MB per worker) backs game review, and it is the pool
         that actually gates a review: the pipeline's first search awaits every
         slot reaching `readyok`, so leaving this to the Analyze click put the
         whole download + wasm compile inside the user's wait (on a cold cache
         that is the single largest slice of "why is the review so slow").
         Booting here moves that cost to page load, where it runs while the
         user is still looking at the board. Warm-up is a readiness handshake
         only — no search runs and no result depends on it, so classifications
         are untouched. ── */
  useEffect(() => {
    warmLiteEngine().catch(() => { /* pool may also boot lazily on first search */ });
    warmReviewEngine().catch(() => { /* same — lazily boots on first review search */ });
  }, []);

  /* ─── restore a saved review session on mount (after refresh or returning
         to the section). URL ?pgn=/?fen= takes priority over the saved one. ── */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pgn') || params.get('fen')) return;
    /* Wait until the signed-in user is known. Restoring earlier would read the
       'anon' slot (or, on a user switch, the wrong account's slot) and then
       immediately persist it under the key that resolves a tick later. */
    if (authLoading) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      /* v3 carries the move tree; a v2 session (saved before variations moved
         into the tree) is still restored — its game, review and mainline ply. */
      if (!s || (s.version !== SESSION_VERSION && s.version !== 2)
        || !Array.isArray(s.moves) || !s.initialFen) return;
      sessionUserRef.current = storageKey;
      restoredFromStorage.current = true;
      setSavedVariation(s.variation || null);
      setRestorePly(s.variation ? null : (Number.isInteger(s.moveIndex) ? s.moveIndex : null));
      setInitialFen(s.initialFen);
      setMoves(s.moves);
      setReview(s.review || null);
      /* a saved session may have been left mid-analysis — analysis is MANUAL
         now: the engine only starts on an explicit "Analyze" click. A review
         still genuinely grinding in the background (section-switch, no refresh)
         re-attaches below; else the board just waits. */
      setState(s.review ? STATE.done : STATE.loaded);
      setProgress(s.review ? 100 : 0);
      setPgnText(s.pgnText || '');
      setSourcePgn(s.sourcePgn || '');
      setGameId(s.gameId || null);
      /* Restored so a session resumed from localStorage still knows which game
         its Sigmas belong to — otherwise the restored review could never be
         filed, and re-analysing it would silently do nothing. */
      setGameOrigin(s.gameOrigin || { gameSource: null, gameRefId: null, playedAt: null });
      setPlayers(s.players || { white: '', black: '' });
      setOrientation(s.orientation || 'white');
    } catch {
      /* corrupt storage — start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── persist the session (finished OR still analysing) so a refresh or
         navigation never loses the review or its in-progress analysis.

         `progress` is a dependency, so while a review runs this effect
         re-serialises the ENTIRE review (every row, including per-row `lines`)
         to localStorage once per completed move — ~60 synchronous writes of a
         growing object on the main thread, right when the engine is saturating
         every core. Throttle progress-only updates so a run persists its
         starting point, a few milestones, and its end state instead; any other
         field changing (a move played, a review finished, a branch edited)
         still writes immediately, since those are user-visible and must never
         be lost. Refresh-during-analysis therefore resumes from the last
         milestone rather than the exact ply — the in-flight rows are re-derived
         by the engine on resume either way.

         The move tree rides along (`variation`), so a refresh keeps every
         branch, its grade and the cursor — even when the cursor is deep inside
         a variation. `tree.revision` is the commit counter: grades and branch
         edits change no other state. ── */
  useEffect(() => {
    if (moves.length === 0 && !review) return;
    /* Never write the on-screen session into a DIFFERENT user's slot. On a
       logout/login switch the key changes while the previous user's board is
       still mounted for one render; without this the first effect run after the
       switch would copy their game + verdicts into the new account's session. */
    if (sessionUserRef.current !== storageKey) return;
    const significant = {
      initialFen, moves, review, pgnText, sourcePgn, gameId, players, orientation, state, gameOrigin,
      variation: tree.serialize(),
    };
    const sig = JSON.stringify(significant);
    const prevSig = lastPersistedSig.current;
    lastPersistedSig.current = sig;

    // While analysing, only a milestone change is worth a write.
    if (prevSig === sig && state === STATE.analyzing) {
      const bucket = Math.floor((progress || 0) / 25) * 25;
      if (bucket === lastProgressBucket.current) return;
      lastProgressBucket.current = bucket;
    }
    lastProgressBucket.current = Math.floor((progress || 0) / 25) * 25;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: SESSION_VERSION,
        ...significant,
        progress,
      }));
    } catch {
      /* storage unavailable — persistence is best-effort */
    }
  }, [initialFen, moves, tree.revision, review, pgnText, sourcePgn, gameId, players, orientation, state, progress, gameOrigin, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyLoaded(fenInit, sanList) {
    setSavedVariation(null);
    setRestorePly(null);
    setInitialFen(fenInit);
    setMoves(sanList);
    setReview(null);
    setError('');
    setState(sanList.length ? STATE.loaded : STATE.empty);
  }

  /* Parse a PGN into board state — the single gate both the paste box and the
     stored-game links go through. It returns the values the review needs
     explicitly ({ init, san, origin }) so the caller can start the analysis
     from the freshly parsed game rather than the React state that is still one
     render behind. On an empty or unparseable paste it sets `error` and returns
     null, so no engine work is ever kicked off for a bad game. */
  function applyPgnToBoard(text, names, origin) {
    const raw = String(text || '').trim();
    if (!raw) {
      setError('Paste a PGN first — there is nothing to review.');
      return null;
    }
    let g;
    try {
      g = new Chess();
      g.loadPgn(raw, { strict: false });
    } catch {
      setError('Could not parse that PGN — check the text and try again.');
      return null;
    }
    const san = g.history().filter(Boolean);
    if (san.length === 0) {
      setError('That PGN has no moves to review.');
      return null;
    }
    /* Canonical initial-position precedence (shared helper): PGN [FEN] wins,
       else the standard position. */
    const init = extractPgnFen(raw) || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    /* PGN tags win: for a pasted game they are the exporter's own record.
       `names` covers the games this app stored, which have no tags. */
    setPlayers({
      white: pgnPlayerName(text, 'White') || names?.white || '',
      black: pgnPlayerName(text, 'Black') || names?.black || '',
    });
    /* A tag-bearing PGN also carries its own date, which is what the Sigma
       date filters need; a game this app stored has none, so the history row's
       date is used instead. Either beats falling back to "now". */
    const tagDate = (text.match(/\[Date\s+"([^"]+)"/) || [])[1];
    const resolvedOrigin = {
      gameSource: origin?.gameSource ?? null,
      gameRefId: origin?.gameRefId ?? null,
      playedAt: origin?.playedAt ?? (tagDate ? normalisePgnDate(tagDate) : null),
    };
    setGameOrigin(resolvedOrigin);
    setSourcePgn(raw);
    applyLoaded(init, san);
    return { init, san, origin: resolvedOrigin };
  }

  /* `origin` tells us which database row this game is, so a finished review can
     file its Sigmas against it. A pasted PGN passes nothing and is deliberately
     left unattached.

     Loading a game IS the request to review it now: validate → put it on the
     board → start Stockfish, with no second "Analyze" click. A bad or empty
     paste shows the error and stops before any engine work. */
  function loadPgnText(text, names, origin) {
    const parsed = applyPgnToBoard(text, names, origin);
    if (!parsed) return;
    /* A brand-new paste supersedes any run still in flight: cancel it and stop
       the engine so two sessions can never write to the same board. */
    try { cancelReview(); stopEngineSearch(); } catch { /* best-effort */ }
    startReviewSession(parsed.init, parsed.san, parsed.origin);
  }

  function loadFenText(f, names) {
    try {
      const g = new Chess(f);
      const san = g.history().filter(Boolean);
      /* A bare position is nobody's game, so names are cleared — unless the
         caller opened it from a history row and knows who played. */
      setPlayers(names ? { white: names.white || '', black: names.black || '' } : { white: '', black: '' });
      setGameOrigin({ gameSource: null, gameRefId: null, playedAt: null });
      setSourcePgn('');
      applyLoaded(f === 'start' ? 'start' : f, san);
    } catch {
      setError('Invalid FEN — please check the position string.');
    }
  }

  /* ─── board setup apply (shared SetupBoardButton) ──
     The modal is seeded from the position currently on the board. Applying
     loads the resulting FEN as the fresh review position (no moves yet);
     cancel leaves the current review state untouched. */
  function handleSetupApply(fen) {
    applyLoaded(fen, []);
  }

  /* ─── save to folder ──
     Saves a solvable puzzle into the chosen Library folder. The puzzle starts
     from the reviewed game's initial FEN and the PGN is the full SAN move line
     (validated move-by-move by buildPuzzlePgn). If the line is empty (e.g. a
     custom Setup Board position) the item is stored as a static FEN, keeping
     full backward compatibility. */
  /* The folder picker reads the SHARED library, so a folder another admin
     created is available here too. */
  async function openSaveModal() {
    setNewFolderOpen(false);
    setNewFolderName('');
    setNewFolderError('');
    setSaveOpen(true);
    try {
      const lib = await fetchLibrary();
      setSaveFolders(lib?.folders || []);
    } catch (err) {
      setSaveFolders([]);
      notify(err?.response?.data?.message || err?.message || 'Could not load folders.', {
        tone: 'error', title: 'Library unavailable',
      });
    }
  }

  function itemTitleFor(folder) {
    return `Position ${folder.items.length + 1}`;
  }

  function buildItemFields(folder) {
    const { startFen, pgn, moves: solved, error } = buildPuzzlePgn({ fen: initialFen, moves });
    if (error) return { error };
    const item = {
      title: itemTitleFor(folder),
      at: new Date().toISOString().slice(0, 10),
      source: 'review',
      fen: startFen,
      pgn: pgn || null,
    };
    return solved && solved.length
      ? { ...item, type: 'pgn', notation: pgn }
      : { ...item, type: 'fen', notation: startFen };
  }

  async function saveToFolder(folder) {
    const fields = buildItemFields(folder);
    if (fields.error) {
      notify(fields.error, { tone: 'error', title: 'Puzzle not saved' });
      return;
    }
    try {
      await apiCreateItem({ ...fields, folderId: folder.id });
      setSaveOpen(false);
      notify(`Saved to ${folder.name}`, { tone: 'success', title: 'Puzzle saved 📋' });
    } catch (err) {
      notify(err?.message || 'Could not save the puzzle.', { tone: 'error', title: 'Puzzle not saved' });
    }
  }

  /* create the folder, then save into it in one action */
  async function createFolderAndSave(e) {
    e.preventDefault();
    const err = validateFolderName(newFolderName, null, saveFolders);
    if (err) {
      setNewFolderError(err);
      setNewFolderName('');
      return;
    }
    let folder;
    try {
      folder = await apiCreateFolder({
        name: newFolderName.trim(),
        parentId: null,
        description: '',
        type: 'general',
      });
    } catch (err2) {
      setNewFolderError(err2?.message || 'Could not create the folder.');
      return;
    }
    setNewFolderOpen(false);
    setNewFolderName('');
    setNewFolderError('');
    await saveToFolder(folder);
  }

  /* ─── opening a Brilliant move's game ──
     A stored sigma carries only (source, gameId, ply) — no PGN — so the game has
     to be resolved before a board can show it.

     THE CARD OPENS FIRST. This hands the card the game's REFERENCE and returns
     immediately; the card resolves the game itself and shows its own loading and
     error states. Awaiting the fetch here and mounting only on success was the
     bug: every failure path — a game that is no longer in history, an offline
     app, a gated endpoint — left the screen completely unchanged, so clicking a
     Brilliant move looked like it did nothing at all. Opening first means there
     is always a visible response, and the reason for any failure is shown in the
     card rather than in a toast that has already faded.

     The ply conversion happened upstream (SigmaMoves), so all this receives is
     the already-resolved move count that leaves the board ON that move. */
  const [sigmaGame, setSigmaGame] = useState(null);

  /* Resolve a stored (gameSource, gameId) into the ORIGINAL game record the card
     opens. The identity rules live in utils/gameIdentity; the LOADERS are the
     app's existing ones — `fetchGame` is the same call Chess Profile's Games tab
     makes, and `/game-history` is the same list its History tab reads. Note the
     asymmetry the resolver documents: fetchGame returns the game ROW (it unwraps
     `.data` itself) while bare api.get returns the RESPONSE. */
  const resolveSigmaGame = useCallback((ref) => resolveSigmaGameRow(ref, {
    fetchProfileGame: fetchGame,
    fetchHistory: () => api.get('/game-history', { cache: false }),
  }), []);

  function openSigmaGame(move, nav) {
    const ref = sigmaGameRef(move);
    if (!ref) {
      showToast('This Brilliant move has no game reference.');
      return;
    }
    setSigmaGame({
      ref,
      moveIndex: nav && typeof nav.moveIndex === 'number' ? nav.moveIndex : null,
      /* Only a profile game has a stored-analysis row to restore; the others
         still get the card, and it offers "Analyze locally". */
      gameId: ref.gameSource === 'chess_profile' ? ref.gameId : null,
      key: `${ref.gameSource}:${ref.gameId}:${move.ply}`,
    });
  }

  /* ─── analysis ──
     The engine work itself runs in the module-scoped reviewRunner, so it keeps
     going even while this component is unmounted (navigating to another
     section). We only kick it off, subscribe to its events and apply results. */
  function applyReviewResult(res) {
    setReview(res);
    setState(STATE.done);
    setProgress(100);
    /* File the Sigmas against the game this review belongs to. Fire-and-forget
       on purpose: the review is already finished and on screen, and a failed
       save must not turn a good review into an error state. */
    if (canPersist(gameOrigin.gameSource, gameOrigin.gameRefId)) {
      persistSigmaMoves({
        review: res,
        gameSource: gameOrigin.gameSource,
        gameId: gameOrigin.gameRefId,
        initialFen,
        moves,
        meta: {
          playedAt: gameOrigin.playedAt,
          whiteName: players.white,
          blackName: players.black,
        },
      });
    }
    /* Variations keep their own one-move rows, and the review's verdicts are
       keyed to MAINLINE plies — a variation that was open while the review ran
       simply starts reading the mainline rows now that they exist. */
    playSound('good');
  }

  /* The runner listener below is attached ONCE (empty dep array), so the
     callback it captures is the one from the FIRST render - where `gameOrigin`
     is still the empty default and `initialFen` / `moves` / `players` describe
     an un-loaded board. Filing Sigmas from that snapshot made `canPersist`
     always false, so the POST never went out and every game the player
     reviewed was missing from the Sigma tab. The listener therefore calls the
     CURRENT copy through this ref, the same way `treeRef` keeps the tree
     reader fresh. */
  const applyReviewRef = useRef(applyReviewResult);
  useEffect(() => { applyReviewRef.current = applyReviewResult; });

  /* The one analysis entry point. The paste / link loader calls it with the
     values it just parsed (so a freshly loaded game is reviewed, not the stale
     state one render behind); every "Re-analyze" button calls it with no
     arguments, using the board as it stands. It awaits the NNUE worker's
     readiness handshake before the first search so the engine never analyses an
     empty or stale position and the boot cost is not billed to the run. */
  async function startReviewSession(init = initialFen, san = moves, origin = gameOrigin) {
    if (!san || san.length === 0) return;
    const id = sessionIdFor(init, san);
    sessionIdRef.current = id;
    setReview(null);
    setError('');
    setEngineDiag('');
    /* A previous boot failure poisons the pool for 150s by design (it would
       otherwise re-hang every search for another full timeout). A manual
       Analyze / Re-analyze is the user saying "try now" — so reset the pool
       first and let the boot error, if any, come back fresh and specific. */
    try { resetReviewEngine(); } catch { /* best-effort */ }
    setState(STATE.analyzing);
    setProgress(0);
    // start the elapsed/ETA clock for this run
    analysisStartRef.current = Date.now();
    setAnalysisTick((n) => n + 1);
    /* The engine is warmed in the BACKGROUND, never awaited.
       A game that has already been reviewed is answered by the canonical cache
       (memory, then the saved analysis in the database) in a few hundred
       milliseconds — and it must not sit behind the Stockfish worker's boot,
       which is exactly what an awaited warm-up made it do. A first-time game
       still gets a warm engine: the warm-up runs alongside the analysis, and
       the pipeline boots lazily on its first search anyway. */
    try { warmReviewEngine().catch(() => { /* the pipeline boots lazily anyway */ }); } catch { /* ignore */ }
    /* The game's canonical identity, when this game came from a stored source.
       It lets the canonical layer reuse an analysis this game already has
       instead of grinding Stockfish again. A pasted PGN passes none and is
       analysed directly. */
    const gameRefArg = origin.gameSource != null && origin.gameRefId != null
      ? { gameSource: origin.gameSource, gameId: origin.gameRefId }
      : null;
    /* Only profile games have a stored-analysis endpoint; the other sources
       still reuse within the session. */
    const analysisStore = gameRefArg && gameRefArg.gameSource === 'chess_profile'
      ? { loadAnalysis: fetchAnalysis, saveAnalysis }
      : null;
    startReview(id, init, san, { gameRef: gameRefArg, analysisStore });
  }

  function runReview() {
    startReviewSession();
  }

  /* attach to the background runner: progress while analysing, verdicts when
     a finish lands — even if that finish happens while we're away. */
  useEffect(() => {
    const detach = attachReview(() => sessionIdRef.current, (snap) => {
      if (!snap.id) return;
      if (snap.done) {
        if (snap.result) applyReviewRef.current(snap.result);
        else if (snap.error) {
          setError(snap.error);
          setState(STATE.loaded);
          /* Surface the engine's own diagnosis alongside the message so a dead
             worker ("failed to boot", "blocked") reads differently from a bad
             game ("no legal moves"). Read live at failure time — the pool may
             have failed after the review started. */
          try {
            const st = reviewEngineStatus();
            if (st && (st.state === 'failed' || st.state === 'booting') && st.lastError) {
              setEngineDiag(st.lastError);
            } else if (st && st.state === 'failed') {
              setEngineDiag('The Stockfish worker failed to start in this browser.');
            } else {
              setEngineDiag('');
            }
          } catch { /* diagnosis is best-effort */ }
        }
      } else if (snap.running) {
        setProgress(snap.progress);
      }
    });
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── MANUAL analysis ──
     The engine NEVER starts on its own. A freshly loaded (or restored) game
     stays on the board in the loaded state until the user presses "Analyze 🧠".
     The only automatic resume allowed: a review that is STILL grinding in the
     background (started by an explicit click earlier — e.g. after navigating
     to another section) re-attaches so it can keep going where it left off. */
  useEffect(() => {
    if (moves.length === 0) return;
    // a session restored from storage already carries its finished review —
    // never re-analyse it.
    if (restoredFromStorage.current) {
      restoredFromStorage.current = false;
      if (review) return;
    }
    // moves entered by hand on the empty board — wait for the manual Analyze button
    if (boardFlowed.current) {
      boardFlowed.current = false;
      return;
    }
    const id = sessionIdFor(initialFen, moves);
    sessionIdRef.current = id;
    /* already computed while we were away → show it straight away */
    const done = finishedReview(id);
    if (done) {
      applyReviewResult(done);
      return;
    }
    /* still grinding in the background → resume watching it */
    if (activeReviewId() === id) {
      setReview(null);
      setError('');
      setState(STATE.analyzing);
      return;
    }
    // otherwise leave the game sitting on the board — no analysis until the
    // user clicks Analyze 🧠.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFen, moves]);

  /* ─── navigation ──
     The tree pointer IS the cursor: a step, a move-list click, a keyboard press
     and a move played on the board all land on a node, and the board reads that
     node's FEN. Nothing is replayed and there are no two copies to keep in
     sync. `tree.goBack`/`goForward` walk the CURRENT line (a variation when the
     pointer is inside one); Home/End and Up/Down are wired below. */

  /* ─── advanced engine (live analysis) ── */
  async function runLiveEval() {
    if (!engineOnRef.current) return;
    const token = ++engineToken.current;
    setEngineBusy(true);
    try {
      const top = await searchTopMovesLite(treeRef.current.currentFen, {
        maxDepth: LIVE_ANALYSIS_DEPTH,
        multiPv: LIVE_ANALYSIS_MULTIPV,
      });
      if (token !== engineToken.current) return;
      const res = top && top[0] ? top[0] : null;
      setLiveEval(res ? {
        pawns: (res.score != null ? res.score : 0) / 100,
        score: res.score ?? 0,
        mate: res.mate ?? null,
        depth: res.depth ?? 0,
        bestUci: res.uci ?? null,
        fen: treeRef.current.currentFen,
        /* every candidate line from the multiPV search — used for the
           best/great/good arrow set over the board */
        lines: (Array.isArray(top) ? top : [])
          .filter((l) => l && l.uci && l.uci.length >= 4)
          .slice(0, 3)
          .map((l) => ({
            uci: l.uci,
            from: l.from || l.uci.slice(0, 2),
            to: l.to || l.uci.slice(2, 4),
            score: l.score ?? null,
          })),
      } : null);
    } catch {
      if (token === engineToken.current) setLiveEval(null);
    } finally {
      if (token === engineToken.current) setEngineBusy(false);
    }
  }

  function toggleEngine() {
    const next = !engineOn;
    setEngineOn(next);
    engineOnRef.current = next;
    try { localStorage.setItem('gr-engine-pref', next ? '1' : '0'); } catch { /* best-effort */ }
    if (next) {
      runLiveEval();
      /* grade any variation moves played while the engine was off */
      const line = treeRef.current.currentLine;
      line.forEach((n) => {
        if (!n.isMainline && !n.row) {
          gradeRef.current?.({ node: n, parent: treeRef.current.nodes[n.parentId] });
        }
      });
    } else {
      engineToken.current++;
      stopEngineSearch();
      stopLiteSearch();
      setLiveEval(null);
      setEngineBusy(false);
    }
  }

  /* re-run the live eval whenever the board position changes while it's on */
  useEffect(() => {
    if (!engineOn) return;
    const t = setTimeout(() => runLiveEval(), 40);
    return () => { clearTimeout(t); engineToken.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.currentFen, engineOn]);

  /* ─── remove every variation ──
     Confirmed, and safe by construction: the original game line is the
     immutable mainline, so this can only delete branches the user played. */
  function resetVariations() {
    if (!window.confirm('Reset to the original game line? This removes every variation and any promoted view.')) return;
    treeRef.current.resetVariations();
  }

  /* ─── vanish the review ──
     Manual "clear" button in the Review card header. Removes the saved
     session (so a refresh stays empty), stops any in-flight analysis and
     resets everything back to the pristine empty page. */
  function vanishReview() {
    cancelReview();
    sessionIdRef.current = null;
    engineToken.current++;
    stopEngineSearch();
    setLiveEval(null);
    setEngineBusy(false);
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    restoredFromStorage.current = false;
    setSavedVariation(null);
    setRestorePly(null);
    setInitialFen('start');
    setMoves([]);
    setReview(null);
    setState(STATE.empty);
    setProgress(0);
    setError('');
    setPgnText('');
    setSourcePgn('');
    setGameId(null);
    setPlayers({ white: '', black: '' });
    /* Detach from any source game — a cleared board belongs to no row, and
       leaving a stale gameRefId would file the next review's Sigmas against a
       game the player is no longer looking at. */
    setGameOrigin({ gameSource: null, gameRefId: null, playedAt: null });
  }

  const verdicts = review?.moves ?? null;

  /* ── the score sheet ──
     One row per move pair on a fixed `# | White | Black` grid, with the
     players' names as a sticky column header inside the scroll container — the
     SHARED VariationMoveList draws it (see components/variation), so Game
     Review, the game viewer card and the classroom cannot drift apart.

     A mainline node takes the review's row for its ply; a variation node
     carries its own one-move row. `verdicts` stays keyed by PLY, so the
     original review's badges, accuracy and summary are the only things any
     mainline cell can ever read.

     Names come from `players`, falling back to the PGN tags still held in
     `pgnText`. That second source matters: a session restored from localStorage
     that was saved before the names existed has an empty `players`, and without
     this it would sit showing "White"/"Black" over a game whose PGN is right
     there in the textarea. */
  const whiteName = String(players.white || pgnPlayerName(pgnText, 'White') || '').trim() || 'White';
  const blackName = String(players.black || pgnPlayerName(pgnText, 'Black') || '').trim() || 'Black';
  /* Compact player rows above/below the board, following its orientation. They
     are shown on a phone only; the score sheet names both players everywhere. */
  const topSide = orientation === 'white' ? 'black' : 'white';
  const bottomSide = orientation === 'white' ? 'white' : 'black';
  const seatName = (side) => (side === 'white' ? whiteName : blackName);
  const seatAcc = (side) => review?.[side]?.accuracy ?? null;

  const rowFor = useCallback((n) => {
    if (!n || n.ply === 0) return null;
    if (!n.isMainline) return n.row || null;
    return verdicts?.[n.ply - 1] || null;
  }, [verdicts]);

  /* ── the ACTIVE line ──
     Everything below (nav cursor, move badges, coach, arrows) reads from the
     node the pointer is on. `activeIdx` counts plies from the tree root, which
     is also the move count of the line, so the nav read-out is unchanged. */
  const inVariation = !tree.isOnMainline;
  const activeIdx = tree.currentPly;
  const activeLen = tree.lineEndPly;
  const currentRow = rowFor(tree.current);
  /* The row of the move that comes NEXT from the position on screen: its
     `bestUci`/`lines` are the engine's answer for exactly this board. */
  const nextRow = rowFor(tree.current.children.length ? tree.nodes[tree.current.children[0]] : null);
  const pendingVar = engineOn ? tree.currentLine.filter((n) => !n.isMainline && !n.row).length : 0;

  /* Keyboard: ←/→ walk the current line, ↑/↓ switch between the moves played
     from the same position (the two sides of a branch), Home/End the ends, F
     flips. Disabled while the full game-viewer card is open, so its listener is
     the only one active. */
  useReviewKeys({
    prev: () => tree.goBack('keyboard'),
    next: () => tree.goForward('keyboard'),
    siblingPrev: () => tree.goSibling(-1, 'keyboard'),
    siblingNext: () => tree.goSibling(1, 'keyboard'),
    first: () => tree.goToStart('keyboard'),
    last: () => tree.goToEnd('keyboard'),
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  }, { enabled: !sigmaGame });

  const curVerdict = currentRow?.verdict ?? null;

  /* Clock Bot winces when playback lands on a blunder or a mistake. Keyed by
     ply so re-renders of the same move do not re-fire it. */
  const botVerdictKey = useRef(null);
  useEffect(() => {
    if (!curVerdict) return;
    const key = `${tree.current?.ply ?? ''}:${curVerdict}`;
    if (botVerdictKey.current === key) return;
    botVerdictKey.current = key;
    if (curVerdict === 'blunder' || curVerdict === 'mistake') BOT.blunder();
  }, [curVerdict, currentRow?.ply]);
  const endGame = useMemo(() => rebuild(initialFen, moves), [initialFen, moves]);
  const result = resultText(endGame);

  const acc = (side) => review?.[side] ?? null;

  /* Per-verdict tallies for the summary table, with the Sigma bucket folded onto
     'brilliant'. A live review already tallies it that way; a session restored
     from before that fix still carries counts.sigma, and reading only
     counts.brilliant would report 0 brilliant moves for a game that plainly has
     one — so both spellings are summed here rather than one being preferred. */
  const sideCounts = useMemo(() => ({
    white: reviewCounts(review?.white?.counts) || {},
    black: reviewCounts(review?.black?.counts) || {},
  }), [review]);

  /* ── best-move arrow for the CURRENT position ──
     The review analysed every position just before each ply was played, so the
     row at `activeIdx` (search that ran on exactly this board) carries the
     engine's suggested best move. In a variation the row may lag the board, so
     the live engine's best move is used as a fallback / primary hint. */
  const bestArrow = useMemo(() => {
    let uci = null;
    if (nextRow && nextRow.bestUci) uci = nextRow.bestUci;
    if (!uci && engineOn && liveEval) uci = liveEval.bestUci;
    if (!uci || uci.length < 4) return null;
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      uci,
    };
  }, [nextRow, engineOn, liveEval]);

  /* ── ONE arrow: the engine's best move ──
     The board used to draw the top THREE multiPV candidates as graded-opacit
     green arrows (best / great / good) with numbered chips on the destinations.
     Two arrows were dropped at the user's request: the board now shows the best
     move only.

     Why that is the right cut rather than a cosmetic one: the review rows are
     ordered best-first, so `lines[0]` IS the best move, and the other two were
     never a suggestion to consider — they were the engine's 2nd and 3rd
     preferences, which a learner reads as "these are also fine" when in fact
     they are moves the position does not allow. One arrow also means the rank
     chip is always "1", which is information-free, so the badge is dropped
     entirely (see `rankedArrows` below) rather than left as a lone 1.

     The MultiPV search itself is unchanged — REVIEW_MULTIPV still searches 3
     lines, because the classifier needs the runner-up gap to decide what counts
     as a forced or clearly-better move (GREAT_MIN_GAP_CP). Only the DRAWING is
     reduced to one.

     Engine ON: the live search of the current position wins. Engine OFF: every
     analysed move saved its multiPV set in the review row, so browsing still
     shows the best-move arrow for each move. When neither exists we fall back
     to the single best-move arrow (saved review `bestUci` or live eval). */
  const TOP_LINE_COLOR = 'rgba(0, 128, 0, 1)';
  const liveLineArrows = useMemo(() => {
    if (!engineOn || !liveEval || !Array.isArray(liveEval.lines) || liveEval.lines.length === 0) return null;
    const l = liveEval.lines[0];
    if (!l || !l.from || !l.to) return null;
    return [{ from: l.from, to: l.to, color: TOP_LINE_COLOR }];
  }, [engineOn, liveEval]);
  const reviewLineArrows = useMemo(() => {
    const ls = nextRow && Array.isArray(nextRow.lines) ? nextRow.lines : [];
    if (!ls.length) return null;
    return ls.slice(0, 1).map((l) => ({
      from: l.from || (l.uci ? l.uci.slice(0, 2) : null),
      to: l.to || (l.uci ? l.uci.slice(2, 4) : null),
      color: TOP_LINE_COLOR,
    })).filter((a) => a.from && a.to);
  }, [nextRow]);
  const topLineArrows = liveLineArrows || reviewLineArrows;

  const sigmaMoves = useMemo(() => {
    if (!verdicts) return [];
    return verdicts.filter((v) => v && isSigmaVerdict(v.verdict));
  }, [verdicts]);

  const sigmaArrows = useMemo(() => {
    /* A Sigma belongs to the ORIGINAL game, so its marker never follows the
       cursor into a variation. */
    if (!sigmaMoves || !tree.isOnMainline) return [];
    const cur = sigmaMoves.find((m) => m.ply + 1 === activeIdx);
    if (!cur || !cur.fromSquare || !cur.toSquare) return [];
    return [{
      from: cur.fromSquare,
      to: cur.toSquare,
      color: '#f59e0b',
    }];
  }, [sigmaMoves, activeIdx, tree.isOnMainline]);

  const arrows = sigmaArrows.length > 0 ? sigmaArrows : (topLineArrows || (bestArrow ? [{ from: bestArrow.from, to: bestArrow.to, color: '#008000' }] : []));
  /* No rank chips. They numbered the top THREE candidates (1 / 2 / 3) to match
     the three graded arrows; with only the best move drawn, the single chip
     would always read "1", which says nothing the arrow itself does not. */
  const rankedArrows = [];

  /* ── every Sigma in this game ──
     The main line's own rows, newest verdict naming included. This is a review of
     ONE game, so it is derived from the in-memory review rather than fetched —
     persistence across games is a separate concern. */

  /* ── move badge for the current board ──
     Show the classification icon on the destination square of the active move
     (the move just played, i.e. index activeIdx-1). Convert algebraic square
     to { file, rank } 0-indexed so ChessBoard can position the overlay. */
  const moveBadge = useMemo(() => {
    const v = currentRow;
    if (!v || !v.uci || v.uci.length < 4) return null;
    const to = v.uci.slice(2, 4);
    return {
      verdict: v.verdict,
      sacrifice: Boolean(v.sacrifice),
      square: to,
      file: to.charCodeAt(0) - 97,       // 0-7
      rank: Number(to[1]) - 1,           // 0-7
    };
  }, [currentRow]);

  /* ── eval bar — ALWAYS visible ──
     With the Advanced Engine ON it shows the live Stockfish eval of the current
     position. OFF, it falls back to the reviewed eval of the position at the
     cursor: the verdict row of the move that produced it (row `activeIdx - 1`).
     Both sources are CENTIPAWNS in White's point of view (the reviewed row
     stores mover-perspective `played`/`playedMate`, signed back to White here)
     and both are turned into pawn units exactly once, by the display helper —
     the stored values themselves are never rewritten. */
  const staticRow = currentRow;
  const toWhite = (v) => (v == null || !staticRow ? null : staticRow.player === 'w' ? v : -v);
  const live = engineOn && liveEval != null;
  const evalCp = live ? liveEval.score : toWhite(staticRow?.played);
  const evalMate = live ? liveEval.mate : toWhite(staticRow?.playedMate);

  /* ── shareable PGN for the loaded game ──
     Reconstructed from initialFen + SAN moves whenever either changes, so the
     export buttons always send the exact game on screen (not a stale one). */
  const exportPgn = useMemo(() => {
    if (!moves.length) return '';
    /* Move text is rebuilt from the board (so variations the user stepped back
       through never leak in); every header comes from the PGN the game was
       loaded from, with the seat names and played-at date filled in when the
       source carried none. */
    return buildFullPgn({
      pgn: sourcePgn,
      moves,
      initialFen,
      white: players.white || pgnPlayerName(sourcePgn, 'White'),
      black: players.black || pgnPlayerName(sourcePgn, 'Black'),
      date: gameOrigin.playedAt,
    });
  }, [initialFen, moves, sourcePgn, players, gameOrigin.playedAt]);

  /* brief inline confirmation under the share row */
  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(''), 2500);
  }

  /* Lichess — deep-link to their "import from PGN" screen, pre-filled. */
  async function copyLichessLink() {
    if (await copyText(`https://lichess.org/paste?pgn=${encodeURIComponent(exportPgn)}`)) {
      showToast('Lichess import link copied!');
    } else {
      showToast('Could not copy — select the link manually.');
    }
  }

  /* Chess.com — no pre-fill URL, so copy the raw PGN + point to their board. */
  async function copyChessCom() {
    const copied = await copyText(exportPgn);
    if (copied) {
      showToast('PGN copied — paste it into Chess.com’s Analysis board.');
      window.open('https://www.chess.com/analysis', '_blank', 'noopener,noreferrer');
    } else {
      showToast('Could not copy the PGN.');
    }
  }

  /* ========================= RENDER ========================= */
  /* The board is sized by ResponsiveBoard from its own column, so it fills a
     phone's width exactly and caps at 560px beside the review panel on desktop.
     The eval bar reserves a fixed lane (10px on a phone, 36px on desktop) and
     the board takes the rest — the pair can never overflow the page. */

  /* The live analysis read-out, shared by the "analyzing" state and the brief
     "loaded" gap before the first engine callback. One definition so the two
     can never drift — the status area used to sit on a static "press Analyze 🧠"
     hint (and a second button) here. */
  const analyzeStatus = (
    <div className="space-y-1.5">
      <div className="gr-searching">
        <SearchCaissa className="gr-searching-art" />
        <p className="gr-hint">
          Analyzing… move {Math.max(1, Math.round((progress / 100) * moves.length))} / {moves.length}
          {analysisElapsed ? ` · ${analysisElapsed}` : ''}
        </p>
      </div>
      <div className="analysis-progress"><div style={{ width: `${progress}%` }} /></div>
      <p className="gr-hint text-right">
        {progress}%{analysisEta ? ` · about ${analysisEta} left` : ''}
      </p>
    </div>
  );

  const renderSeat = (side, pos) => {
    const name = seatName(side);
    const accValue = seatAcc(side);
    return (
      <div className={`gr-seat gr-seat--${pos}`}>
        <span className="gr-seat-dot" aria-hidden="true">{side === 'white' ? '⚪' : '⚫'}</span>
        <span className="gr-seat-name" title={name}>{name}</span>
        {accValue != null && <span className="gr-seat-acc">{accValue}%</span>}
        {pos === 'top' && (
          <span className="gr-seat-eval" title="Evaluation">{formatEvalScore(evalCp, evalMate)}</span>
        )}
      </div>
    );
  };

  return (
    <Page title="Game Review" piece="♚" wide className="gr-page gr-screen">
      {tab === 'review' && (
        <button onClick={goBack} className="gr-nav-btn gr-screen-back" title="Go back">← Back</button>
      )}
      <div className="gr-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'review'}
          onClick={() => switchTab('review')}
          className={`gr-tab${tab === 'review' ? ' gr-tab-active' : ''}`}
        >
          ♚ Analyse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => switchTab('history')}
          className={`gr-tab${tab === 'history' ? ' gr-tab-active' : ''}`}
        >
          ♟ History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sigma'}
          onClick={() => switchTab('sigma')}
          className={`gr-tab${tab === 'sigma' ? ' gr-tab-active' : ''}`}
        >
          σ Brilliant Moves
        </button>
      </div>

      {/* THREE tabs, ONE ternary. The Sigma screen used to be rendered as a
          sibling ABOVE this block, which meant that with tab === 'sigma' this
          ternary still fell through to its review branch and drew the whole
          analysis board underneath the Sigma screen. Any tab that is not
          'history' must land here, so the boards and the two screens stay
          mutually exclusive. */}
      <div className={`gr-view${tab === 'review' ? ' gr-view--board' : ' gr-view--scroll'}`}>
      {tab === 'sigma' ? (
        <SigmaMoves
          user={authUser}
          userId={sigmaUserId}
          canPickUser={isAdmin}
          /* Clicking a Brilliant opens the SAME full-game analysis card the
             Chess Profile Games tab uses, positioned on that move with its
             canonical classification — not a purpose-built sigma viewer. The card
             is mounted over the review board so the review itself is untouched.

             `nav.moveIndex` is the move COUNT that leaves the board ON the
             brilliant move (already played); it is computed once, by ply, in
             sigmaDisplay.plyToMoveIndex — never from the move number, which for
             25...Bxg3 would select White's 25th move instead of Black's. */
          onOpenGame={(m, nav) => openSigmaGame(m, nav)}
        />
      ) : tab === 'history' ? (
        <GameHistory
          embedded
          onOpenGame={(g) => {
            /* whiteName/blackName are absolute - they describe the columns of the
               score sheet, not "me" and "them", so an admin opening a student's
               game sees the same two names the student saw. */
            /* A headers-only PGN would be rejected by the review parser with
               "no moves to review"; only hand it over when it really contains
               moves, otherwise open the saved final position. */
            if (pgnHasMoves(g)) {
              /* The history row's `id` is prefixed by type ("computer_12"), which
                 is exactly the (source, id) pair the Sigma API needs. */
              const raw = String(g.id || '');
              const underscore = raw.indexOf('_');
              const type = underscore > 0 ? raw.slice(0, underscore) : null;
              const num = underscore > 0 ? Number(raw.slice(underscore + 1)) : NaN;
              const source = type === 'computer' ? 'computer'
                : type === 'online' ? 'online'
                  : null;
              loadPgnText(buildRowPgn(g, authUser?.name), { white: g.whiteName, black: g.blackName }, {
                gameSource: source,
                gameRefId: source && Number.isInteger(num) ? num : null,
                playedAt: g.date || null,
              });
            } else if (g.fen) {
              /* A board with no saved moves (e.g. a tournament forfeit) can
                 still be opened as its final position instead of doing nothing. */
              loadFenText(g.fen, { white: g.whiteName, black: g.blackName });
            }
            switchTab('review');
          }}
        />
      ) : (
      <>
      <div className="gr-layout">
        {/* ═════════════ BOARD ═════════════ */}
        <div className="gr-board-col">
          {renderSeat(topSide, 'top')}
          {/* board + live eval bar */}
          <div className="gr-board-glow">
            <div className="gr-board-row">
              <div className="gr-board-fit">
                {/* A slim 16px track, exactly as tall as the board. The numeric
                    score lives in the top seat row, so the label would only
                    overhang this narrow bar and sit on the board. */}
                <EvalBar
                  evaluation={evalCp}
                  mate={evalMate}
                  orientation={orientation}
                  height="auto"
                  width={16}
                  showLabel={false}
                />
                <VariationBoard
                  className="gr-board-responsive"
                  /* The layout decides the size (--s); the sizer must not cap it
                     at the old 400px default. */
                  maxWidth={2000}
                  tree={tree}
                  onTreeMove={onTreeMove}
                  mode="analysis"
                  orientation={orientation}
                  interactive
                  showLegalMoves
                  engineOn={engineOn}
                  customArrows={arrows}
                  reviewVerdictColor={reviewMetaFor(curVerdict)?.color || null}
                  moveBadge={moveBadge}
                  /* Named, so a step (keyboard, move-list click, jump) plays its
                     effect on THIS board even when another board was touched
                     last. */
                  moveEffectHostId={reviewBoardHostId}
                  /* Always empty now that only the best-move arrow is drawn —
                     see `rankedArrows`. Passed explicitly so the prop is not
                     accidentally reintroduced with the old three-arrow logic. */
                  lineBadges={rankedArrows}
                  /* No `frameless` here: the review board shows the saved Board
                     Frame like every other board. It can no longer cost space —
                     the frame is carved out of the box the sizer measured, so the
                     column is the same width with the frame on as with it off. */
                />
              </div>
            </div>
          </div>
          {renderSeat(bottomSide, 'bottom')}

          {/* The Best/Great/Good word legend that used to sit here is gone, and so are the
              2nd and 3rd arrows: the board now draws the engine's best move only.
              The words repeated what arrow opacity said; the extra arrows said
              more than they should, since a learner reads "the engine also likes
              these" rather than "these are worse". The search still runs 3 lines
              internally — the classifier needs the runner-up gap — it just no
              longer draws them. */}

          {/* nav */}
          <div className="gr-nav">
            <button onClick={() => tree.goToStart('nav')} disabled={activeIdx === 0} className="gr-nav-btn" title="Start">⏮</button>
            <button onClick={() => tree.goBack('nav')} disabled={activeIdx === 0} className="gr-nav-btn" title="Previous">◀</button>
            <span className="gr-nav-count">{activeIdx} / {activeLen}</span>
            <button onClick={() => tree.goForward('nav')} disabled={activeIdx >= activeLen} className="gr-nav-btn" title="Next">▶</button>
            <button onClick={() => tree.goToEnd('nav')} disabled={activeIdx >= activeLen} className="gr-nav-btn" title="End">⏭</button>
            <button
              onClick={() => tree.goToStart('nav')}
              disabled={activeIdx === 0}
              className="gr-nav-btn"
              title="Reset board to the start of the game"
            >↺ Reset</button>
            {/* Visible only inside a variation: jumps to the game move this
                branch was played from — the branch itself is kept. */}
            {inVariation && (
              <button
                onClick={() => tree.returnToMainline('nav')}
                className="gr-nav-btn gr-nav-btn--on"
                title="Back to the original line — this variation is kept"
              >← Original</button>
            )}
            <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="gr-nav-btn" title="Flip board">⇄</button>
            {/* advanced engine toggle — live Stockfish eval + variation grading */}
            <button
              onClick={toggleEngine}
              className={`gr-nav-btn${engineOn ? ' gr-nav-btn--on' : ''}`}
              title="Advanced engine — live Stockfish evaluation of the current position and per-move grading inside variations. Preference saved per user."
            >
              🧠{engineOn ? ' ON' : ''}
            </button>
            {/* Setup Board — shared component, same button + modal on the admin
                and student shells, inline in the nav row under the board */}
            <SetupBoardButton
              getInitialFen={() => treeRef.current.currentFen}
              onApply={handleSetupApply}
            />

            {/* Save to Folder — admin only; opens the folder-selection modal */}
            {showSetupButton && (
              <Button
                onClick={openSaveModal}
                variant="secondary" size="sm" className="!h-8 !px-3 text-xs"
                title="Save the current board position into one of your folders"
              >
                💾 Save
              </Button>
            )}
          </div>
        </div>

        {/* ═════════════ SIDE ═════════════ */}
        <div className="gr-side">
          <div className="gr-side-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'moves'}
              onClick={() => setSideTab('moves')}
              className={`gr-tab${sideTab === 'moves' ? ' gr-tab-active' : ''}`}
            >
              ♘ Moves
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'load'}
              onClick={() => setSideTab('load')}
              className={`gr-tab${sideTab === 'load' ? ' gr-tab-active' : ''}`}
            >
              ⚡ Load a game
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'review'}
              onClick={() => setSideTab('review')}
              className={`gr-tab${sideTab === 'review' ? ' gr-tab-active' : ''}`}
            >
              📊 Review
            </button>
          </div>

          <div className="gr-panel">
            {sideTab === 'moves' && (
              <div className="gr-moves-card">
                <div className="gr-moves-head">
                  <span className="gr-moves-title">
                    ♘ Moves
                    {tree.hasVariations && (
                      <span className="gr-moves-title-var">
                        {' '}+ {tree.variationCount} variation{tree.variationCount === 1 ? '' : 's'}
                        {pendingVar > 0 ? ' · grading…' : ''}
                      </span>
                    )}
                  </span>
                  <span className="gr-moves-head-right">
                    {result && <span className="gr-score-result">{result}</span>}
                    <span className="gr-moves-count">{activeLen}</span>
                    {tree.hasVariations && (
                      <button
                        type="button"
                        className="var-moves-reset"
                        onClick={resetVariations}
                        title="Remove every variation and restore the original game"
                      >Reset to original</button>
                    )}
                    {moves.length > 0 && (
                      <button
                        type="button"
                        className="gr-moves-toggle"
                        aria-expanded={movesOpen}
                        aria-controls="gr-moves-list"
                        onClick={() => setMovesOpen((v) => !v)}
                        title={movesOpen ? 'Hide the moves panel' : 'Show the moves panel'}
                      >
                        {movesOpen ? '▾' : '▸'}
                      </button>
                    )}
                  </span>
                </div>
                {movesOpen && (moves.length === 0 ? (
                  <p className="gr-moves-empty">No moves — paste a PGN in “⚡ Load a game”, or open a review link.</p>
                ) : (
                  <div className="gr-movelist gr-movelist--var" id="gr-moves-list">
                    <VariationMoveList
                      tree={tree}
                      headless
                      whiteName={whiteName}
                      blackName={blackName}
                      rowOf={rowFor}
                      showSigma
                      scrollHost=".gr-movelist--var"
                      emptyText="No moves — paste a PGN in “⚡ Load a game”, or open a review link."
                    />
                  </div>
                ))}
              </div>
            )}

            {sideTab === 'load' && (
              <div className="gr-panel-scroll">
                <div className="gr-load">
            <button
              type="button"
              className="gr-load-toggle"
              onClick={() => setLoadOpen((o) => !o)}
              aria-expanded={loadOpen}
            >
              <span className="gr-load-line" />
              <span className="gr-load-label">⚡ Load a game</span>
              <span className={`gr-load-line${loadOpen ? ' gr-load-line--fill' : ''}`} />
            </button>
            {loadOpen && (
              <div className="gr-load-body">
                <p className="gr-hint">Paste a PGN to review. The local Stockfish engine (in your browser) analyses every move.</p>
                <textarea
                  className="gr-input"
                  rows={3}
                  placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …"
                  value={pgnText}
                  onChange={(e) => setPgnText(e.target.value)}
                />
                {error && <div className="chess-error !mb-2 !py-1.5 text-xs">{error}</div>}
                <Button
                  onClick={() => loadPgnText(pgnText)}
                  disabled={!pgnText.trim() || state === STATE.analyzing}
                  variant="primary" size="md" fullWidth className="!w-full !py-2 text-sm"
                >
                  {state === STATE.analyzing ? 'Analyzing… 🧠' : 'Review pasted game 🧠'}
                </Button>
              </div>
            )}
                </div>
              </div>
            )}

            {sideTab === 'review' && (
              <div className="gr-panel-scroll">
                {(moves.length > 0 || review) && (
                  <div className="gr-review-head">
                    <Button
                      onClick={vanishReview}
                      variant="secondary" size="sm" className="!h-7 !px-2.5 !text-[0.68rem]"
                      title="Delete this review and start a fresh game"
                    >
                      ✕ Vanish
                    </Button>
                  </div>
                )}
            {moves.length === 0 ? (
              <p className="gr-hint">Nothing to review yet — paste a PGN in “⚡ Load a game”; it starts analysing on its own.</p>
            ) : state === STATE.analyzing ? (
              analyzeStatus
            ) : error ? (
              <div className="space-y-1.5">
                <div className="chess-error !py-1.5 text-xs">{error}</div>
                <Button onClick={runReview} variant="primary" size="sm" fullWidth className="!w-full !py-2 text-xs">↺ Re-analyze</Button>
              </div>
            ) : state === STATE.loaded ? (
              analyzeStatus
            ) : review ? (
              <div className="space-y-3">
                {inVariation && (
                  <Button
                    onClick={() => tree.returnToMainline('nav')}
                    variant="secondary" size="sm" fullWidth className="!w-full !py-2 text-xs"
                    title="Return to the original line — this variation is kept"
                  >
                    ← Back to Original Line
                  </Button>
                )}
                <div className="gr-result">
                  <p className="gr-opening">
                    {review.opening ? `♜ ${review.opening}` : '♜ Custom / off-book opening'}
                  </p>
                  {result && <p className="gr-result-line">{result}</p>}
                  {gameId && (
                    <p className="gr-hint">Game session #{gameId} · from your result card</p>
                  )}
                </div>

                {/* no engine data on any real move → don't fake a score (all-book games are fine, they get '—') */}
                {review.white.movesPlayed === 0 && review.black.movesPlayed === 0 && review.moves.some((m) => m.verdict !== 'book') && (
                  <p className="gr-hint gr-hint-warn">
                    ⚠️ No engine evaluations came back — accuracy can't be computed. Try re-analyzing, or check the Stockfish WASM loaded.
                  </p>
                )}

                {/* accuracy per player */}
                {['white', 'black'].map((side) => {
                  const a = acc(side);
                  const pct = a && a.accuracy != null ? a.accuracy : null;
                  const isSide = side === 'white';
                  return (
                    <div key={side} className="gr-acc">
                      <div className="gr-acc-head">
                        <span className="gr-acc-name">{isSide ? '⚪ White' : '⚫ Black'}</span>
                        <span className="gr-acc-val">
                          {pct == null ? '—' : `${pct}%`}
                          <span className="gr-acc-cpl">
                            {a && a.avgCpl != null ? `avg ${a.avgCpl} cpl` : ''}
                          </span>
                        </span>
                      </div>
                      <div className="gr-accbar"><div className="gr-accbar-fill" style={{ width: pct == null ? 0 : `${Math.round(pct)}%` }} /></div>
                      {a && a.total > 0 && a.movesPlayed < a.total && (
                        <p className="gr-hint">
                          ⚠️ {isSide ? 'White' : 'Black'}: reviewed {a.movesPlayed} of {a.total} moves — accuracy is over the analysed ones.
                        </p>
                      )}
                    </div>
                  );
                })}

                <p className="gr-formula" title="Per move: win% dropped = winPercent(best) − winPercent(played); accuracy = 103.1668·e^(−0.04354·win%dropped) − 3.1669, clamped 0–100. The game score is the plain mean of those per-move grades (chess.com's CAPS headline). Book moves count the full 100; un-analysed rows excluded.">
                  accuracy = 103.17·e<sup>−0.04354·win% lost</sup> − 3.17{' '}
                  <span className="text-ivory-500">· book = 100 · plain mean</span>
                </p>

                {/* summary table */}
                <table className="gr-sheet">
                  <thead>
                    <tr>
                      <th className="gr-th" />
                      <th className="gr-th gr-th-center">Moves</th>
                      <th className="gr-th gr-th-center">⚪</th>
                      <th className="gr-th gr-th-center">⚫</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REVIEW_ORDER.map((key) => {
                      const meta = REVIEW_META[key];
                      const w = sideCounts.white[key] || 0;
                      const b = sideCounts.black[key] || 0;
                      const hide = w === 0 && b === 0;
                      return (
                        <tr key={key} className={`gr-row${hide ? ' gr-row-zero' : ''}`}>
                          <td className="gr-td">
                            <RankBadge verdict={key} size={18} label={meta.label} className="gr-badge-row" />
                          </td>
                          <td className="gr-td gr-td-center">{w + b}</td>
                          <td className="gr-td gr-td-center">{w}</td>
                          <td className="gr-td gr-td-center">{b}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="flex gap-2">
                  <Button onClick={runReview} variant="primary" size="sm" className="!flex-1 !py-2 text-xs">↺ Re-analyze</Button>
                  <Button onClick={vanishReview}
                    variant="secondary" size="sm" className="!flex-1 !py-2 text-xs">♞ New review</Button>
                </div>
              </div>
            ) : (
              analyzeStatus
            )}
                <div className="gr-legend">
                  {REVIEW_ORDER.map((key) => (
                    <RankBadge key={key} verdict={key} size={19} className="gr-legend-item" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* admin-only Customize Position modal */}
      {/* Save to Folder — pick a Library folder (or create one) to store the position */}
      {saveOpen && (
        <Portal><div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center p-3 sm:p-4"
          style={{ background: 'rgba(28, 33, 23, 0.55)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSaveOpen(false); }}
        >
          <div
            className="w-full overflow-x-hidden"
            style={{
              maxWidth: 620,
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '1.25rem',
              background: 'linear-gradient(160deg, var(--ink-800), var(--ink-900))',
              border: '1px solid var(--surface-border)',
              boxShadow: '0 8px 26px rgba(23, 23, 23, 0.18), 0 1px 0 rgba(59, 130, 246, 0.1)',
            }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3
                className="flex items-center gap-2 font-display font-semibold text-lg"
                style={{ color: 'var(--ivory-100)' }}
              >
                <span aria-hidden>💾</span> Save to Folder
              </h3>
              <Button
                type="button"
                onClick={() => setSaveOpen(false)}
                title="Close"
                variant="secondary" size="md" className="!h-8 !w-8 !p-0 grid place-items-center text-lg font-semibold"
                style={{ color: 'var(--ivory-300)' }}
              >
                ✕
              </Button>
            </div>

            <div className="px-5 pb-5">
              <p className="text-xs" style={{ color: 'var(--ivory-700)' }}>
                Pick a Library folder — the current board position will be saved into it as FEN.
              </p>

              {/* folder cards */}
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {getRootFolders(saveFolders).map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => saveToFolder(f)}
                    style={{ animation: `fade-up .35s ${Math.min(i * 0.04, 0.3)}s both` }}
                    className="text-left rounded-xl border border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06] hover:border-gold-500/30 p-3 transition group flex items-center gap-3 w-full"
                  >
                    <span className="text-xl shrink-0 transition-transform group-hover:scale-110">📁</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-bold text-ivory-300 text-sm truncate">{f.name}</span>
                        {f.items.length > 0 && (
                          <span className="chess-chip !text-[10px]">{f.items.length}</span>
                        )}
                      </span>
                      <span className="block text-[0.62rem] uppercase tracking-wider text-ivory-500 mt-0.5 truncate">
                        {f.type} · {f.createdAt}
                      </span>
                    </span>
                  </button>
                ))}

                {/* new folder */}
                {newFolderOpen ? (
                  <form
                    onSubmit={createFolderAndSave}
                    className="rounded-xl border border-dashed border-gold-500/40 bg-gold-500/[0.03] p-3 flex flex-col gap-2"
                  >
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => { setNewFolderName(e.target.value); setNewFolderError(''); }}
                      placeholder="Folder name…"
                      className="chess-input w-full !py-2 !text-xs"
                    />
                    {newFolderError && (
                      <p className="text-[0.7rem] text-red-600">⚠ {newFolderError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" size="sm" className="!flex-1 !py-2 text-xs">
                        Create & Save
                      </Button>
                      <Button
                        type="button"
                        onClick={() => { setNewFolderOpen(false); setNewFolderName(''); setNewFolderError(''); }}
                        variant="secondary" size="sm" className="!py-2 !px-3 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setNewFolderOpen(true)}
                    className="rounded-xl border border-dashed border-ivory-700/60 bg-black/[0.02] hover:border-gold-500/40 hover:bg-gold-500/[0.04] p-3 transition flex items-center justify-center gap-2 text-sm font-semibold text-ivory-400 w-full"
                  >
                    <span className="text-lg leading-none">+</span> New Folder
                  </button>
                )}
              </div>

              {getRootFolders(saveFolders).length === 0 && !newFolderOpen && (
                <p className="text-xs mt-3" style={{ color: 'var(--ivory-500)' }}>
                  No folders yet — create one above to start saving positions.
                </p>
              )}
            </div>
          </div>
        </div></Portal>
      )}
      </>
)}
      </div>

      {/* A Brilliant move opened from the list: the shared full-game analysis
          card (the same one Chess Profile uses), sitting on top of this review.
          `moveIndex` puts the board AFTER the selected move; `key` includes the
          source+id+ply so switching between two brilliant moves in the same game
          remounts the card on the new move instead of reusing its state. */}
      {sigmaGame && (
        <GameViewerCard
          key={sigmaGame.key}
          gameRef={sigmaGame.ref}
          resolveGame={resolveSigmaGame}
          initialMoveIndex={sigmaGame.moveIndex}
          gameId={sigmaGame.gameId}
          loadAnalysis={sigmaGame.gameId ? fetchAnalysis : null}
          /* Both halves of the store, exactly as Chess Profile passes them.
             Without `saveAnalysis` an analysis run from this card lived only in
             the in-memory LRU, so a page reload silently ran Stockfish again —
             the cache looked broken here while working on Chess Profile. */
          saveAnalysis={sigmaGame.gameId ? saveAnalysis : null}
          onClose={() => setSigmaGame(null)}
        />
      )}
    </Page>
  );
}