import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import ResponsiveBoard from '../components/ResponsiveBoard';
import useMediaQuery from '../hooks/useMediaQuery';
import { formatEvalScore } from '../lib/evalDisplay';
import useVisibleEffectHost from '../hooks/useVisibleEffectHost';
import SetupBoardButton from '../components/SetupBoardButton';
import { Page, Card } from '../components/ui';
import { isAdminRole } from '../utils/roles';
import { playSound } from '../utils/sound';
import { stopEngineSearch, warmEngine as warmReviewEngine, resetReviewEngine, reviewEngineStatus } from '../utils/nnueEngine';
import { stopEngineSearch as stopLiteSearch, searchTopMoves as searchTopMovesLite, warmEngine as warmLiteEngine } from '../utils/engine';
import { classifySideMove } from '../utils/reviewSideLine';
import { extractPgnFen } from '../utils/canonicalAnalysis';
import { sanitizeFen } from '../utils/fen';
import { copyText } from '../utils/clipboard';
import { followActiveMove } from '../utils/scrollActiveMove';
import GameViewerCard from '../components/GameViewerCard';
import { fetchGame, fetchAnalysis, saveAnalysis } from '../services/chessProfiles';
import { resolveSigmaGame as resolveSigmaGameRow, sigmaGameRef } from '../utils/gameIdentity';
import { buildScoreRows, fenStartsBlack, pgnPlayerName } from '../lib/scoreSheet';
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
  // GameReview needs scrolling (move list, analysis), so do NOT request full height

  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = location.pathname.startsWith('/admin');
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(`${isAdmin ? '/admin' : '/student'}/dashboard`);
  };
  const gameRef = useRef(new Chess());
  /* persistence: a restored review is marked so its auto-review is skipped */
  const restoredFromStorage = useRef(false);
  /* which background session (reviewRunner) this component is attached to */
  const sessionIdRef = useRef(null);
  /* moves played by hand on an empty board are the player exploring — do NOT
     auto-start the engine review for them; they press "Analyze" when ready */
  const boardFlowed = useRef(false);

  const [initialFen, setInitialFen] = useState('start');
  const [moves, setMoves] = useState([]);
  const [moveIndex, setMoveIndex] = useState(0);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [lastMove, setLastMove] = useState(null);
  const [orientation, setOrientation] = useState('white');
  const isMobileBoard = useMediaQuery('(max-width: 900px)');
  const [movesOpen, setMovesOpen] = useState(true);

  const [state, setState] = useState(STATE.empty);
  const [progress, setProgress] = useState(0);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [pgnText, setPgnText] = useState('');
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

  /* ── side line / variation ──
     When the player deviates from the actual game moves, the original review
     (moves + badges + accuracy) is NEVER touched — we branch into a variation
     that carries the main-line prefix and its verdict rows, then grades new
     moves live (see utils/reviewSideLine.js). */
  const [mode, setMode] = useState('review');          // 'review' | 'sideline'
  /* The review board's effect host id. Named, so every effect this page
     triggers (a step, a move-list click, a variation move) lands on the board
     the user is looking at. */
  const reviewBoardHostId = useId();
  useVisibleEffectHost(reviewBoardHostId);
  const [sideLine, setSideLine] = useState(null);      // { base, mainCursor, moves, moveIndex, rows }
  const sideLineRef = useRef(null);
  useEffect(() => { sideLineRef.current = sideLine; }, [sideLine]);

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
         FULL NNUE (~113 MB per worker) backs game review, and it is the pool
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
      if (!s || s.version !== SESSION_VERSION || !Array.isArray(s.moves) || !s.initialFen) return;
      sessionUserRef.current = storageKey;
      restoredFromStorage.current = true;
      const idx = s.moveIndex ?? s.moves.length;
      /* a saved session may have been sitting inside a variation — restore it
         wherever the user left off (board rebuilt from the active line). */
      if (s.mode === 'sideline' && s.sideLine && Array.isArray(s.sideLine.moves)) {
        gameRef.current = rebuild(s.initialFen, s.sideLine.moves.slice(0, s.sideLine.moveIndex ?? s.sideLine.moves.length));
        setSideLine(s.sideLine);
        setMode('sideline');
      } else {
        gameRef.current = rebuild(s.initialFen, s.moves.slice(0, idx));
        setSideLine(null);
        setMode('review');
      }
      setInitialFen(s.initialFen);
      setMoves(s.moves);
      setMoveIndex(idx);
      setReview(s.review || null);
      /* a saved session may have been left mid-analysis — analysis is MANUAL
         now: the engine only starts on an explicit "Analyze" click. A review
         still genuinely grinding in the background (section-switch, no refresh)
         re-attaches below; else the board just waits. */
      setState(s.review ? STATE.done : STATE.loaded);
      setProgress(s.review ? 100 : 0);
      setPgnText(s.pgnText || '');
      setGameId(s.gameId || null);
      /* Restored so a session resumed from localStorage still knows which game
         its Sigmas belong to — otherwise the restored review could never be
         filed, and re-analysing it would silently do nothing. */
      setGameOrigin(s.gameOrigin || { gameSource: null, gameRefId: null, playedAt: null });
      setPlayers(s.players || { white: '', black: '' });
      setOrientation(s.orientation || 'white');
      setFen(gameRef.current.fen());
      const hist = gameRef.current.history({ verbose: true });
      setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
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
         field changing (a move played, a review finished, mode/side-line
         edits) still writes immediately, since those are user-visible and
         must never be lost. Refresh-during-analysis therefore resumes from the
         last milestone rather than the exact ply — the in-flight rows are
         re-derived by the engine on resume either way. ── */
  useEffect(() => {
    if (moves.length === 0 && !review) return;
    /* Never write the on-screen session into a DIFFERENT user's slot. On a
       logout/login switch the key changes while the previous user's board is
       still mounted for one render; without this the first effect run after the
       switch would copy their game + verdicts into the new account's session. */
    if (sessionUserRef.current !== storageKey) return;
    const significant = { initialFen, moves, moveIndex, review, pgnText, gameId, players, orientation, mode, sideLine, state, gameOrigin };
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
  }, [initialFen, moves, moveIndex, review, pgnText, gameId, players, orientation, mode, sideLine, state, progress, gameOrigin, storageKey]);

  function applyLoaded(fenInit, sanList) {
    gameRef.current = rebuild(fenInit, sanList);
    setMode('review');
    setSideLine(null);
    setInitialFen(fenInit);
    setMoves(sanList);
    setMoveIndex(sanList.length);
    setReview(null);
    setError('');
    setFen(gameRef.current.fen());
    const hist = gameRef.current.history({ verbose: true });
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
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
    /* a variation opened while the MAIN review was still running inherited
       no prefix rows; now that it's done, backfill the main-line verdicts
       it branches from (live tail rows are preserved). */
    setSideLine((prev) => {
      if (!prev) return prev;
      const prefix = res.moves.slice(0, prev.base);
      const liveTail = prev.rows.slice(prev.base);
      return { ...prev, rows: prefix.concat(liveTail) };
    });
    playSound('good');
  }

  /* The runner listener below is attached ONCE (empty dep array), so the
     callback it captures is the one from the FIRST render - where `gameOrigin`
     is still the empty default and `initialFen` / `moves` / `players` describe
     an un-loaded board. Filing Sigmas from that snapshot made `canPersist`
     always false, so the POST never went out and every game the player
     reviewed was missing from the Sigma tab. The listener therefore calls the
     CURRENT copy through this ref, the same way `sideLineRef` keeps the side
     line reader fresh. */
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
     `go` walks the ACTIVE line: the side line while in a variation, the main
     line otherwise. The board is always rebuilt from scratch so a stale
     gameRef can never leak between lines. */
  function go(idx, source = 'review-nav') {
    const inVar = mode === 'sideline' && sideLineRef.current;
    let target;
    let row;
    if (inVar) {
      const s = sideLineRef.current;
      target = Math.max(0, Math.min(s.moves.length, idx));
      gameRef.current = rebuild(initialFen, s.moves.slice(0, target));
      setSideLine({ ...s, moveIndex: target });
      row = s.rows?.[target - 1] || null;
    } else {
      target = Math.max(0, Math.min(moves.length, idx));
      gameRef.current = rebuild(initialFen, moves.slice(0, target));
      setMoveIndex(target);
      row = verdicts?.[target - 1] || null;
    }
    setFen(gameRef.current.fen());
    const hist = gameRef.current.history({ verbose: true });
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    playEffectForMove(target, source, {
      game: gameRef.current,
      verdict: row?.verdict || null,
      sacrifice: Boolean(row?.sacrifice),
      orientation,
    });
  }

  /* navigate the MAIN line from a move-list click even while a variation is up —
     re-entering the original review at `idx` plies (the variation stays stored). */
  function goMain(idx) {
    const target = Math.max(0, Math.min(moves.length, idx));
    gameRef.current = rebuild(initialFen, moves.slice(0, target));
    setMoveIndex(target);
    setMode('review');
    setFen(gameRef.current.fen());
    const hist = gameRef.current.history({ verbose: true });
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    const row = verdicts?.[target - 1] || null;
    playEffectForMove(target, 'review-main', {
      game: gameRef.current,
      verdict: row?.verdict || null,
      sacrifice: Boolean(row?.sacrifice),
      orientation,
    });
  }

  /* ─── interactive play on the board ──
     ChessBoard applies the move directly to the shared gameRef.current (it's the
     controlled game), then calls back here. Key rule: a move that DIFFERS from
     the actual game notation at the current move number must NOT destroy the
     original review — it opens a variation branch (side line) that inherits the
     main-line prefix + its verdict rows and gets graded live. The main review
     (moves, badges, accuracy) stays intact for "Back to Game Review". */
  function onBoardMove() {
    const g = gameRef.current;
    const hist = g.history({ verbose: true });
    const san = hist.map((m) => m.san);

    /* inside a variation: the new move extends (or replaces the tail of) the
       active side line — never the main line. */
    if (mode === 'sideline' && sideLineRef.current && moves.length > 0) {
      extendSideLine(san);
      return;
    }

    /* no game line to preserve — the played moves ARE the main line (old flow) */
    if (moves.length === 0) {
      boardFlowed.current = true;
      setMoves(san);
      setMoveIndex(san.length);
      setFen(g.fen());
      setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
      if (review) { setReview(null); setState(STATE.loaded); }
      return;
    }

    /* deviation check: the board was at `moveIndex` of the actual game; the new
       ply (at index `moveIndex`) either matches the game's next move (normal
       forward step) or departs from it (open a variation). */
    const sameAsGame = moveIndex < moves.length && san[moveIndex] === moves[moveIndex];
    if (sameAsGame) {
      setMoveIndex(moveIndex + 1);
      setFen(g.fen());
      setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    } else {
      enterSideLine(moveIndex, san);
    }
  }

  /* ── open a variation from the main line ──
     `base` = number of MAIN plies before the branch; `san` = the full played
     line (main prefix + new move(s)). Rows start as a copy of the main review's
     verdict rows for the prefix, then live rows are appended per move. */
  function enterSideLine(base, san) {
    setMode('sideline');
    setSideLine({
      base,
      mainCursor: moveIndex,
      moves: san,
      moveIndex: san.length,
      rows: (review?.moves || []).slice(0, base),
    });
    const g = gameRef.current;
    const hist = g.history({ verbose: true });
    setFen(g.fen());
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    if (engineOn) classifyNewSideMove(0);
  }

  /* extend the active variation with a newly played move / replace its tail */
  function extendSideLine(san) {
    const s = sideLineRef.current;
    if (!s) return;
    setSideLine({ ...s, moves: san, moveIndex: san.length });
    const g = gameRef.current;
    const hist = g.history({ verbose: true });
    setFen(g.fen());
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    if (engineOn) {
      const k = san.length - 1 - s.base;   // 0-based index of the new move INSIDE the variant
      if (k >= 0) classifyNewSideMove(k);
    }
  }

  /* grade variant move `k` (0-based within the variant) live with the engine */
  async function classifyNewSideMove(k) {
    const s = sideLineRef.current;
    if (!s) return;
    const rowIndex = s.base + k;            // absolute ply index in the full line
    const before = rebuild(initialFen, s.moves.slice(0, rowIndex));
    /* Canonical pipeline (classifySideMove is a one-move reviewGame with the
       canonical engine config) — no local depth overrides. */
    const row = await classifySideMove(before.fen(), {
      san: s.moves[rowIndex],
      ply: rowIndex,
    });
    if (!row) return;
    setSideLine((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.slice(0, rowIndex);
      /* pad ungraded slots so rows[base + k] always maps to variant move k */
      while (rows.length < rowIndex) rows.push(null);
      rows.push(row);
      return { ...prev, rows };
    });
  }

  /* ── back to the main review ──
     Restores the ORIGINAL line exactly (moves, badges, accuracy, cursor). The
     variation is kept stored, so clicking a variant move re-enters it. */
  function restoreMainLine() {
    const s = sideLineRef.current;
    const target = s && s.mainCursor != null ? s.mainCursor : moveIndex;
    goMain(target);
  }

  /* enter/continue the variation at `ply` (absolute full-line ply index) —
      also used to RE-ENTER a collapsed variation from a variant-move click. */
  function goVariant(ply) {
    const s = sideLineRef.current;
    if (!s) return;
    setMode('sideline');
    const target = Math.max(0, Math.min(s.moves.length, ply));
    gameRef.current = rebuild(initialFen, s.moves.slice(0, target));
    setSideLine({ ...s, moveIndex: target });
    setFen(gameRef.current.fen());
    const hist = gameRef.current.history({ verbose: true });
    setLastMove(hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null);
    const row = s.rows?.[target - 1] || null;
    playEffectForMove(target, 'review-variation', {
      game: gameRef.current,
      verdict: row?.verdict || null,
      sacrifice: Boolean(row?.sacrifice),
      orientation,
    });
  }

  /* ── advanced engine (live analysis) ── */
  async function runLiveEval() {
    if (!engineOn) return;
    const token = ++engineToken.current;
    setEngineBusy(true);
    try {
      const top = await searchTopMovesLite(gameRef.current.fen(), {
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
        fen: gameRef.current.fen(),
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
    try { localStorage.setItem('gr-engine-pref', next ? '1' : '0'); } catch { /* best-effort */ }
    if (next) {
      runLiveEval();
      /* grade any variation moves played while the engine was off */
      if (mode === 'sideline' && sideLineRef.current) {
        const s = sideLineRef.current;
        const graded = s.rows.length - s.base;
        for (let k = Math.max(0, graded); k < s.moves.length - s.base; k++) {
          classifyNewSideMove(k);
        }
      }
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
  }, [fen, engineOn]);

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
    gameRef.current = new Chess();
    setMode('review');
    setSideLine(null);
    setInitialFen('start');
    setMoves([]);
    setMoveIndex(0);
    setFen(gameRef.current.fen());
    setLastMove(null);
    setReview(null);
    setState(STATE.empty);
    setProgress(0);
    setError('');
    setPgnText('');
    setGameId(null);
    setPlayers({ white: '', black: '' });
    /* Detach from any source game — a cleared board belongs to no row, and
       leaving a stale gameRefId would file the next review's Sigmas against a
       game the player is no longer looking at. */
    setGameOrigin({ gameSource: null, gameRefId: null, playedAt: null });
  }

  const verdicts = review?.moves ?? null;

  /* ── the score sheet ──
     The gm games replay sheet, ported: one row per move pair on a fixed
     `# | White | Black` grid, with the players' names as a sticky column header
     inside the scroll container.

     The list used to TILE pairs across an `auto-fill` grid. Denser, but it
     cannot carry a header — a `grid-column: 1 / -1` head put "White" over the
     left half of the panel and "Black" over the right half, true of the first
     pair only and wrong for every pair after it. Hence the single column: it is
     what makes a real header possible.

     `verdicts[idx]` is keyed by PLY, and so is the click target (`go(idx+1)`).
     The rows carry their ply from buildScoreRows rather than the render
     recomputing `rowIndex * 2 + column` - that expression is what silently
     shifts every verdict by one cell on a black-opening game.

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
  const scoreRows = useMemo(
    () => buildScoreRows(moves, fenStartsBlack(initialFen)),
    [moves, initialFen],
  );

  /* ── the ACTIVE line ──
     Everything below (nav cursor, move badges, coach, arrows) reads from the
     line currently on the board: the variation while in sideline mode, the main
     review otherwise. Variation rows = inherited main-line prefix + live rows. */
  const inVariation = mode === 'sideline' && sideLine;
  const activeMoves = inVariation ? sideLine.moves : moves;
  const activeRows  = inVariation ? sideLine.rows : verdicts;
  const activeIdx   = inVariation ? sideLine.moveIndex : moveIndex;
  const activeLen   = activeMoves.length;
  const pendingVar  = inVariation ? Math.max(0, sideLine.moves.length - sideLine.rows.length) : 0;

  /* Keyboard: ←/→ prev/next, ↑/Home first, ↓/End last, F flip. Disabled while
     the full game-viewer card is open, so its listener is the only one active. */
  useReviewKeys({
    prev: () => go(activeIdx - 1, 'keyboard'),
    next: () => go(activeIdx + 1, 'keyboard'),
    first: () => go(0, 'keyboard'),
    last: () => go(activeLen, 'keyboard'),
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  }, { enabled: !sigmaGame });

  /* Keep the highlighted notation move visible as the user steps/plays.
     INSIDE the list only: scrollIntoView() walks up the ancestor chain and
     scrolls the document too, which dragged the whole page every time the
     active move changed. The list is the only thing allowed to move, and only
     when the active move is outside it. */
  const movelistRef = useRef(null);
  useEffect(() => {
    followActiveMove(movelistRef.current, '.gr-mv.active');
  }, [activeIdx, mode, verdicts]);

  const curVerdict = activeRows && activeIdx > 0 ? activeRows[activeIdx - 1]?.verdict ?? null : null;
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
    const row = activeRows && activeIdx < activeRows.length ? activeRows[activeIdx] : null;
    if (row && row.bestUci) uci = row.bestUci;
    if (!uci && engineOn && liveEval) uci = liveEval.bestUci;
    if (!uci || uci.length < 4) return null;
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      uci,
    };
  }, [activeRows, activeIdx, engineOn, liveEval]);

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
    const row = activeRows && activeIdx < activeRows.length ? activeRows[activeIdx] : null;
    const ls = row && Array.isArray(row.lines) ? row.lines : [];
    if (!ls.length) return null;
    return ls.slice(0, 1).map((l) => ({
      from: l.from || (l.uci ? l.uci.slice(0, 2) : null),
      to: l.to || (l.uci ? l.uci.slice(2, 4) : null),
      color: TOP_LINE_COLOR,
    })).filter((a) => a.from && a.to);
  }, [activeRows, activeIdx]);
  const topLineArrows = liveLineArrows || reviewLineArrows;

  const sigmaMoves = useMemo(() => {
    if (!verdicts) return [];
    return verdicts.filter((v) => v && isSigmaVerdict(v.verdict));
  }, [verdicts]);

  const sigmaArrows = useMemo(() => {
    if (!sigmaMoves) return [];
    const cur = sigmaMoves.find((m) => m.ply + 1 === activeIdx);
    if (!cur || !cur.fromSquare || !cur.toSquare) return [];
    return [{
      from: cur.fromSquare,
      to: cur.toSquare,
      color: '#f59e0b',
    }];
  }, [sigmaMoves, activeIdx]);

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
    const v = activeRows && activeIdx > 0 ? activeRows[activeIdx - 1] : null;
    if (!v || !v.uci || v.uci.length < 4) return null;
    const to = v.uci.slice(2, 4);
    return {
      verdict: v.verdict,
      sacrifice: Boolean(v.sacrifice),
      square: to,
      file: to.charCodeAt(0) - 97,       // 0-7
      rank: Number(to[1]) - 1,           // 0-7
    };
  }, [activeRows, activeIdx]);

  /* ── eval bar — ALWAYS visible ──
     With the Advanced Engine ON it shows the live Stockfish eval of the current
     position. OFF, it falls back to the reviewed eval of the position at the
     cursor: the verdict row of the move that produced it (row `activeIdx - 1`).
     Both sources are CENTIPAWNS in White's point of view (the reviewed row
     stores mover-perspective `played`/`playedMate`, signed back to White here)
     and both are turned into pawn units exactly once, by the display helper —
     the stored values themselves are never rewritten. */
  const staticRow = activeRows && activeIdx > 0 ? activeRows[activeIdx - 1] : null;
  const toWhite = (v) => (v == null || !staticRow ? null : staticRow.player === 'w' ? v : -v);
  const live = engineOn && liveEval != null;
  const evalCp = live ? liveEval.score : toWhite(staticRow?.played);
  const evalMate = live ? liveEval.mate : toWhite(staticRow?.playedMate);

  /* ── shareable PGN for the loaded game ──
     Reconstructed from initialFen + SAN moves whenever either changes, so the
     export buttons always send the exact game on screen (not a stale one). */
  const exportPgn = useMemo(() => {
    try {
      const g = rebuild(initialFen, moves);
      return moves.length ? g.pgn() : '';
    } catch {
      return '';
    }
  }, [initialFen, moves]);

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
        {pos === 'top' && isMobileBoard && (
          <span className="gr-seat-eval" title="Evaluation">{formatEvalScore(evalCp, evalMate)}</span>
        )}
      </div>
    );
  };

  return (
    <Page title="Game Review" piece="♚" sub="Post-game analysis — every move classified by Stockfish." wide className="gr-page">
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
              loadPgnText(g.pgn, { white: g.whiteName, black: g.blackName }, {
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
      <Button onClick={goBack} variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs mb-3">← Back</Button>
      <div className="gr-layout">
        {/* ═════════════ BOARD ═════════════ */}
        <div className="gr-board-col">
          {renderSeat(topSide, 'top')}
          {/* board + live eval bar */}
          <div className="gr-board-glow">
            <div className="gr-board-row">
              <div className="gr-board-fit">
                {/* The bar and its label share one box: the bar clips its fills
                    to the rounded ends, the label sits beside it and may
                    overhang — a boxed value is wider than the track. On a phone
                    it becomes a thin 10px strip and the score moves to the chip
                    in the top seat row, so the board keeps the full width. */}
                <EvalBar
                  evaluation={evalCp}
                  mate={evalMate}
                  orientation={orientation}
                  height="auto"
                  width={isMobileBoard ? 10 : undefined}
                  showLabel={!isMobileBoard}
                />
                <ResponsiveBoard
                  className="gr-board-responsive"
                  maxWidth={560}
                  game={gameRef.current}
                  mode="analysis"
                  orientation={orientation}
                  interactive
                  showLegalMoves
                  onMove={onBoardMove}
                  engineOn={engineOn}
                  customArrows={arrows}
                  lastMove={lastMove}
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
                  /* Raw board — no plinth/ornament frame. The review grid is
                     dense, and the decorative band around the board ate space
                     the position itself needs. */
                  frameless
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
            <button onClick={() => go(0)} disabled={activeIdx === 0} className="gr-nav-btn" title="Start">⏮</button>
            <button onClick={() => go(activeIdx - 1)} disabled={activeIdx === 0} className="gr-nav-btn" title="Previous">◀</button>
            <span className="gr-nav-count">{activeIdx} / {activeLen}</span>
            <button onClick={() => go(activeIdx + 1)} disabled={activeIdx >= activeLen} className="gr-nav-btn" title="Next">▶</button>
            <button onClick={() => go(activeLen)} disabled={activeIdx >= activeLen} className="gr-nav-btn" title="End">⏭</button>
            <button
              onClick={() => goMain(0)}
              disabled={mode !== 'sideline' && activeIdx === 0}
              className="gr-nav-btn"
              title="Reset board to the start of the game"
            >↺ Reset</button>
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
              getInitialFen={() => gameRef.current.fen()}
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

          {/* move list */}
          <div className="gr-moves-card">
            <div className="gr-moves-head">
              <span className="gr-moves-title">
                ♘ Moves
                {mode === 'sideline' && sideLine && (
                  <span className="gr-moves-title-var"> + variation</span>
                )}
              </span>
              <span className="gr-moves-head-right">
                {result && <span className="gr-score-result">{result}</span>}
                <span className="gr-moves-count">{activeLen}</span>
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
              <p className="gr-moves-empty">No moves — paste a PGN on the right, or open a review link.</p>
            ) : (
              <>
                <div className="gr-movelist" id="gr-moves-list" role="list" aria-label="Game moves" ref={movelistRef}>
                  {/* the replay sheet's header: number | White | Black, on the
                      same grid as the rows below it. */}
                  <div className="gr-mvhead" role="row">
                    <span role="columnheader">#</span>
                    <span role="columnheader" className="is-white" title={`White — ${whiteName}`}>
                      {whiteName}
                    </span>
                    <span role="columnheader" className="is-black" title={`Black — ${blackName}`}>
                      {blackName}
                    </span>
                  </div>
                  {scoreRows.map((row) => (
                    <div key={row.label} className="gr-mvpair" role="row">
                      <span className="gr-mvnum" role="rowheader">{row.label}</span>
                      {[
                        { san: row.white, ply: row.whitePly },
                        { san: row.black, ply: row.blackPly },
                      ].map((cell, off) => {
                        if (cell.ply === null) return <span key={off} className="gr-mv-slot" role="gridcell" />;
                        const v = verdicts ? verdicts[cell.ply] : null;
                        const meta = v ? reviewMetaFor(v.verdict) : null;
                        /* A Sigma that also names its type (Queen Sacrifice, …). */
                        const sigma = v && v.sigma ? v.sigma : null;
                        const active = mode !== 'sideline' && cell.ply + 1 === activeIdx;
                        return (
                          <button
                            key={off}
                            role="gridcell"
                            data-gr-ply={cell.ply + 1}
                            onClick={() => (mode === 'sideline' ? goMain(cell.ply + 1) : go(cell.ply + 1))}
                            className={`gr-mv${active ? ' active' : ''}`}
                            aria-current={active ? 'true' : undefined}
                            title={meta
                              ? `${sigma ? sigma.label : meta.label}${v.loss > 0 ? ` · lost ${(v.loss / 100).toFixed(2)} pawns` : ''}`
                              : ''}
                          >
                            {meta && (
                              <RankBadge verdict={v.verdict} size={17} showLabel={false} className="gr-mv-badge" />
                            )}
                            {cell.san}
                            {sigma && (
                              <span className="gr-mv-sigma" aria-label={sigma.label}>σ</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* ── variation (side line): indented, graded live.
                     Stays visible even back in the main review — clicking a
                     variant move re-enters it (goVariant flips to sideline). ── */}
                {sideLine && (
                  <div className="gr-variant">
                    <div className="gr-variant-head">
                      <span className={`gr-variant-title${pendingVar > 0 ? ' gr-variant-busy' : ''}`}>
                        ⟳ Variation{pendingVar > 0 ? ' — grading…' : ''}
                      </span>
                      {mode === 'sideline' && (
                        <Button
                          onClick={restoreMainLine}
                          variant="secondary" size="sm" className="!h-6 !px-2.5 !text-[0.65rem]"
                          title="Return to the actual game — the original review is untouched"
                        >
                          ← Back to Game Review
                        </Button>
                      )}
                    </div>
                    <p className="gr-variant-sub">
                      Branched after {sideLine.base} {sideLine.base === 1 ? 'move' : 'moves'} · your line is analyzed
                      {engineOn ? ' live by Stockfish' : ''} · the main-line badges &amp; accuracy are untouched.
                    </p>
                    <div className="gr-variant-moves">
                      {sideLine.moves.slice(sideLine.base).map((sanM, k) => {
                        const row = sideLine.rows[sideLine.base + k];
                        const meta = row ? reviewMetaFor(row.verdict) : null;
                        const ply = sideLine.base + k + 1;
                        const active = sideLine.moveIndex === ply;
                        return (
                          <button
                            key={k}
                            onClick={() => goVariant(ply)}
                            className={`gr-mv gr-variant-mv${active ? ' active' : ''}`}
                            title={meta
                              ? `${meta.label}${row.loss > 0 ? ` · lost ${(row.loss / 100).toFixed(2)} pawns` : ''}`
                              : (engineOn ? 'Grading this move…' : '')}
                          >
                            {row
                              ? <RankBadge verdict={row.verdict} size={17} showLabel={false} className="gr-mv-badge" />
                              : (engineOn ? <span className="gr-variant-pending" /> : null)}
                            {sanM}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ))}
          </div>
        </div>

        {/* ═════════════ SIDE ═════════════ */}
        <div className="gr-side">
          {/* load row — thin horizontal line; click toggles the paste area */}
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

          {/* summary card */}
          <Card
            title="Review"
            piece="📊"
            actions={(moves.length > 0 || review) ? (
              <Button
                onClick={vanishReview}
                variant="secondary" size="sm" className="!h-7 !px-2.5 !text-[0.68rem]"
                title="Delete this review and start a fresh game"
              >
                ✕ Vanish
              </Button>
            ) : undefined}
          >
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
                {mode === 'sideline' && (
                  <Button
                    onClick={restoreMainLine}
                    variant="secondary" size="sm" fullWidth className="!w-full !py-2 text-xs"
                    title="Return to the actual game — the original review is untouched"
                  >
                    ← Back to Game Review
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
          </Card>

          {/* legend */}
          <div className="gr-legend">
            {REVIEW_ORDER.map((key) => (
              <RankBadge key={key} verdict={key} size={19} className="gr-legend-item" />
            ))}
          </div>
        </div>
      </div>

      {/* admin-only Customize Position modal */}
      {/* Save to Folder — pick a Library folder (or create one) to store the position */}
      {saveOpen && (
        <div
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
        </div>
      )}
      </>
)}

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