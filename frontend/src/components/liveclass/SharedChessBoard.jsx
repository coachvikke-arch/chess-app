import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Button from '../Button';
import { useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import ChessBoard from '../ChessBoard';
import CustomizePositionModal from '../CustomizePositionModal';
import { useLiveClass } from '../../context/LiveClassContext';
import { useAuth } from '../../context/AuthContext';
import { emit, on } from '../../services/socket';
import api from '../../services/api';
import { searchBest } from '../../utils/engine';
import { BOT_LEVELS, botLevelConfig } from '../../utils/botLevels';
import { copyText } from '../../utils/clipboard';
import { detectNotation, pgnGameLabel, splitPgnGames, tryLoadFen, tryLoadPgn } from '../../utils/pgnTools';
import { createClassroomBotGames } from '../../utils/online';
import { createSolver, fenAtPly, MOVE_ANIM_SECONDS, MOVE_ANIM_MS } from '../../utils/puzzleSolve';
import { clearMoveEffects } from '../../effects/moveEffect';
import { CLASSROOM_BOARD_MIN } from '../../hooks/useBoardWidth';
import {
  highlightColorForModifiers,
  highlightsToSquareStyles,
  toggleHighlight,
} from '../../utils/liveHighlights';
import MoveFeedbackOverlay, {
  resolveMoveFeedback,
  useMoveFeedback,
} from '../puzzle/PuzzlePopups';
import { revealAfterCheckmate } from '../../effects/moveEffect';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* Board sizing bounds. The board is sized from the space that is actually
   there — the measured stage width AND the viewport height left below the
   board's top edge — and is capped by the SMALLER of the two so it stays a
   perfect square. There is deliberately NO fixed size ceiling: the board keeps
   growing until it fills the available classroom area. `MAX_BOARD` is only an
   absolute first-paint / corrupt-storage safety net, chosen far above any real
   screen, so it can never be the thing that stops the board growing. */
const MIN_BOARD = CLASSROOM_BOARD_MIN;
const MAX_BOARD = 2400;
/* Bottom breathing room kept below the board when capping it against the
   viewport height, so the frame's lowest rank/file labels never touch the
   bottom edge of the screen. */
const BOARD_BOTTOM_GAP = 24;
/* Frame arithmetic mirrors ChessBoard's own framedWidth — duplicated here so the
   width walk-down is deterministic and cannot oscillate through re-renders. */
const FIT_SLACK = 6;
const framedWidth = (bw) => bw + 2 * Math.min(46, Math.max(20, Math.round(bw * 0.082))) + 24;

/**
 * The one shared board every viewer in the room looks at — and, when a drill is
 * running, the board a student solves it on.
 *
 * Two optional props, both handed in by PuzzleDrill, deliberately as nodes and
 * plain data rather than logic so the drill's own vocabulary stays with the
 * drill:
 *
 *  - `drillStatus` is a read-only node the student sees on the panel (points,
 *    attempts, right/wrong moves). It is placed, not interpreted.
  *  - `drill` = { fen, solution, interactive, points, onCorrectMove, onSolved, onFailed }
  *    switches the board into drill mode: it holds a PRIVATE copy of the puzzle
 *    position and validates attempts against the solution, emitting nothing.
 *    That is the only way "solve on the shared board" can be true while the
 *    board is one position broadcast to the whole room — every other viewer's
 *    pieces must not move because one student tried a wrong move.
 */
export default function SharedChessBoard({ drill = null, drillStatus = null, onDrillViewPly = null }) {
  const [manualSize, setManualSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem('liveBoardManualSize') || '0');
      return n >= MIN_BOARD && n <= MAX_BOARD ? n : null;
    } catch {
      return null;
    }
  });
  const [boardSize, setBoardSize] = useState(() => {
    if (manualSize !== null) return manualSize;
    if (typeof window === 'undefined') return MIN_BOARD;
    return Math.max(MIN_BOARD, Math.min(MAX_BOARD, window.innerWidth - 160));
  });
  const [resizeHandleVisible, setResizeHandleVisible] = useState(() => {
    try { return localStorage.getItem('liveBoardResizeHandle') === '1'; } catch { return false; }
  });
  const [toolsOpen, setToolsOpen] = useState(false);
  const sizeDragRef = useRef(null);
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const fitRef = useRef(null);
  /* The latest measured ceiling for the board (min of the available width and
     the viewport height left below the board). Written by the fit effect and
     read by the drag handler, so a manual drag is clamped to the SAME real
     bound the auto-fit uses instead of a fixed constant. */
  const maxFitRef = useRef(MAX_BOARD);
  const flashTimerRef = useRef(null);
  /* The drill info card, and how much width it is taking. Both declared up
     here, ABOVE the fit effect that spends them: a hook's dependency array is
     read while the component renders, so a value bound further down is still in
     its temporal dead zone when the effect is created, and reading it throws
     before the board ever appears.

     The card is tracked as the NODE it renders to (a callback ref) rather than
     by watching `drillActive`/`drillStatus`, because those are declared further
     down for the same reason. The node appears and disappears exactly when the
     card does, so it is the same signal without the ordering hazard. */
  const [infoCardEl, setInfoCardEl] = useState(null);
  const infoCardRef = useCallback((el) => { setInfoCardEl(el); }, []);
  const [infoCardWidth, setInfoCardWidth] = useState(0);

  /* Yellow glow feedback on any button clicked inside the board wrap. */
  const handleBoardClick = useCallback((e) => {
    const btn = e.target?.closest && e.target.closest('button');
    if (!btn || !wrapRef.current || !wrapRef.current.contains(btn)) return;
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    btn.classList.remove('live-btn-flash');
    requestAnimationFrame(() => btn.classList.add('live-btn-flash'));
    flashTimerRef.current = window.setTimeout(() => btn.classList.remove('live-btn-flash'), 550);
  }, []);

  /* The themed frame IS the user's Board Frame preference: this board passes no
     `frameless` prop, so ChessBoard follows that preference (its `showFrame =
     boardFrame`). The fit below must know whether the frame is really drawn —
     framed, the frame's band is reserved out of the bound; frameless, the bare
     square is free to use the WHOLE bound (that is the fix for the "without
     frame" board being stuck small). Read it here, ABOVE the effect, so the
     effect can name it without hitting its temporal dead zone. */
  const { user, boardFrame } = useAuth();
  const framedBoard = boardFrame !== false;

  /* Fit the board to the stage: capped by the available WIDTH, the available
     HEIGHT (viewport left below the board's top edge), and — only when the frame
     is actually shown — its band, so the full board fits on screen instead of
     hanging below the fold. The board is a square in normal flow, so it never
     depends on the stage's height. The frame's extra size is measured off the
     DOM arithmetic and the cap is walked down deterministically, so it cannot
     oscillate through renders. A dragged size overrides this until it is
     double-clicked away.

     `infoCardWidth` is subtracted because the drill info card is a sibling of
     the board INSIDE the stage, so the stage's own width still counts it. Left
     in, the board is fitted against space that is not there and spills off the
     edge — the exact bug the fitting exists to prevent. */
  useEffect(() => {
    const area = stageRef.current;
    if (!area) return undefined;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const compute = () => {
      const cs = getComputedStyle(area);
      const gap = num(parseFloat(cs.columnGap) || parseFloat(cs.gap)) || 0;
      const availW = area.clientWidth - num(parseFloat(cs.paddingLeft)) - num(parseFloat(cs.paddingRight))
        - infoCardWidth - (infoCardWidth > 0 ? gap : 0);
      const widthLimit = availW - FIT_SLACK;
      /* Height budget = viewport minus everything above the board. The stage's
         document offset (scroll-independent) is the header + caption + card
         head already occupying the top of the screen; 24px is the bottom
         breathing room. If the board starts below the viewport there is nothing
         to fit against, so the cap is lifted. */
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const stageTop = area.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
      const heightLimit = stageTop < vh ? (vh - stageTop - BOARD_BOTTOM_GAP - FIT_SLACK) : Infinity;
      const bound = Math.min(widthLimit, heightLimit);
      /* Reserve the frame's band ONLY when the frame is drawn. Frameless the
         board's footprint is the bare square, so it may use the whole bound;
         reserving the band unconditionally is what capped the frameless board
         ~2·band smaller than its space and stopped the resize handle growing it. */
      const footprint = (bw) => (framedBoard ? framedWidth(bw) : bw);
      let cap = Math.min(MAX_BOARD, bound);
      while (cap > MIN_BOARD && footprint(cap) > bound) cap -= 2;
      cap = Math.max(MIN_BOARD, cap);
      /* Expose the real measured ceiling to the drag handler (below). */
      maxFitRef.current = cap;
      const next = manualSize !== null ? Math.min(manualSize, cap) : cap;
      setBoardSize((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
    };
    compute();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(compute);
      ro.observe(area);
    }
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
    };
  }, [manualSize, infoCardWidth, framedBoard]);

  const resizePointerDown = useCallback((e) => {
    e.preventDefault();
    sizeDragRef.current = { x: e.clientX, start: boardSize };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [boardSize]);

  const resizePointerMove = useCallback((e) => {
    if (!sizeDragRef.current) return;
    const next = sizeDragRef.current.start + (e.clientX - sizeDragRef.current.x);
    /* Clamp to the measured classroom bound — the same ceiling the auto-fit
       uses — so a drag can grow the board to the full available space but can
       never push it past the container/screen (which would crop it or make the
       page scroll). */
    const ceiling = Math.max(MIN_BOARD, maxFitRef.current || MAX_BOARD);
    const clamped = Math.max(MIN_BOARD, Math.min(ceiling, next));
    setBoardSize(clamped);
    setManualSize(clamped);
    try { localStorage.setItem('liveBoardManualSize', String(clamped)); } catch (_) {}
  }, []);

  const resetBoardSize = useCallback(() => {
    setManualSize(null);
    try { localStorage.removeItem('liveBoardManualSize'); } catch (_) {}
    if (sizeDragRef.current) sizeDragRef.current = null;
  }, []);

  const { classMeta, isInstructor, permissions, chessState, participants, patchPermissions, setClassMeta, viewIndex, setViewIndex, remoteReview, setRemoteReview } = useLiveClass();
  const navigate = useNavigate();
  const [playOffer, setPlayOffer] = useState(false);
  const [fen, setFen] = useState(chessState?.fen || START_FEN);
  const [orientation, setOrientation] = useState('white');
  const [annotations, setAnnotations] = useState(chessState?.annotations || { arrows: [], highlights: [] });
  /* Local-only engine suggestion arrow — rendered only on THIS board (instructor),
     never broadcast to students like real annotations. */
  const [bestArrow, setBestArrow] = useState(null);
  const [studentMoveSide, setStudentMoveSide] = useState(classMeta?.studentMoveSide || 'both'); // class-wide both | white | black
  const [moveGrants, setMoveGrants] = useState(classMeta?.moveGrants || []); // [{ userId, moveSide }]
  const [setupOpen, setSetupOpen] = useState(false);
  /* Position panel: paste a FEN (a single position) or a PGN (a whole game, so
     the move list and undo/redo come back with it). `posText` is the raw paste,
     `posGameIndex` picks one game out of a multi-game PGN. */
  const [posOpen, setPosOpen] = useState(false);
  const [posText, setPosText] = useState('');
  const [posError, setPosError] = useState('');
  const [posGameIndex, setPosGameIndex] = useState(0);
  const [toast, setToast] = useState('');
  const [moves, setMoves] = useState(chessState?.moves || []);
  const [redoCount, setRedoCount] = useState(0);
  const [lastMove, setLastMove] = useState(chessState?.lastMove || null);
  const [bestThinking, setBestThinking] = useState(false);
  const [botSide, setBotSide] = useState(null); // 'white' | 'black' | null (off) — Computer vs Students
  const [botArmed, setBotArmed] = useState(false); // bot only plays after "Fix the pairing" is confirmed
  const [botCreating, setBotCreating] = useState(false); // per-student bot games are being created
  const [botLevel, setBotLevel] = useState(6); // 1..12 Computer playing strength (matches Play Arena bot levels)
  const [selectedBotStudents, setSelectedBotStudents] = useState([]);
  const [botAuto, setBotAuto] = useState(true);
  const [botPanelOpen, setBotPanelOpen] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const botTimerRef = useRef(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteStudents, setInviteStudents] = useState([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [selectedInviteStudents, setSelectedInviteStudents] = useState([]);
  const [inviteSending, setInviteSending] = useState(false);

  const gameRef = useRef(null);
  if (!gameRef.current) {
    gameRef.current = new Chess(fen);
  }

  /* Nothing has been applied to the live instance yet: `gameRef` was seeded with
     the bare `fen`, so it has the POSITION but none of the history. Initialising
     this to `fen` instead would make the boot `chessState` look "already applied"
     and skip loading its PGN, leaving `moves` empty on a board that joins a game
     already in progress — so the move list looked full while Prev/Next stayed
     dead. `null` forces the first snapshot to be applied. */
  const appliedFenRef = useRef(null);
  /* Half-moves currently on the board's own instance — the fallback ordering
     key for snapshots that carry no server revision (the HTTP boot). */
  const boardPlyRef = useRef(0);
  /* The last authoritative state applied, as the server's (epoch, rev). Used to
     drop a replayed echo, a stale ack or a snapshot that was overtaken by live
     moves while React was committing it — the class game is single-sourced
     from the server and a state must never move the board backwards. Reset on
     remount, so a refreshed page starts from whatever the server says now. */
  const lastBoardRevRef = useRef(null);
  /* Last known CLASS position. Only meaningful while a drill owns the board,
     where it is what the board is restored to when the drill ends — the class
     does not pause for a student's solve. */
  const classFenRef = useRef(fen);
  /* The drill's solver: ply count, solution line, wrong-move veto and the
     automatic defender reply. This is the SAME module the homework trainer
     solves against (utils/puzzleSolve.js), so a puzzle cannot behave one way in
     the classroom and another way on the puzzles page.

     It counts its own plies rather than reading `game.history()`, because the
     Chess instance on this board is the CLASS game's: `load()` is skipped when a
     drill's starting position is the position the class had already reached,
     which leaves the class's moves in the history and shifts every index the
     solution is read at. */
  const drillSolverRef = useRef(null);
  if (!drillSolverRef.current) drillSolverRef.current = createSolver([]);
  /* The position the board is currently holding FOR a drill, so a hand-back can
     tell "a different drill started" from "the student just moved". */
  const drillFenRef = useRef(null);
  /* The defender's reply is brought in a beat after the student's move, so it
     arrives as its own position change and the piece slides (see
     utils/puzzleSolve). While it is pending the drill is not playable. */
  const drillReplyTimerRef = useRef(null);
  const [, setDrillReplying] = useReducer((n) => n + 1, 0);
  const drillReplying = drillReplyTimerRef.current != null;
  /* On-board move feedback — the SAME module the homework trainer uses, so a
     puzzle looks and sounds identical in both places. Sound stays OFF in the
     classroom; the instructor's view never enters drill mode, so it never
     shows these popups. */
  const {
    feedback: drillFeedback,
    show: showDrillFeedback,
    clear: clearDrillFeedback,
  } = useMoveFeedback({ soundOn: false });
  const busyRef = useRef(false);
  const toastTimerRef = useRef(null);
  const annotationsRef = useRef(annotations);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  const flash = useCallback((msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2600);
  }, []);

  /* Keep `infoCardWidth` honest: measured, not assumed. The card is fluid between
     its floor and its ceiling, and on a narrow screen it leaves the board's row
     entirely — where it must count as zero, or the board is fitted against width
     the card is not using. */
  useEffect(() => {
    if (!infoCardEl) { setInfoCardWidth(0); return undefined; }
    const update = () => {
      /* Laid out beside the board (not stacked under it) → it takes width away
         from the board. Stacked, it takes none, and the board has already been
         fitted against the full width. */
      const stage = infoCardEl.parentElement?.getBoundingClientRect();
      const rect = infoCardEl.getBoundingClientRect();
      const beside = stage ? rect.left < stage.left : false;
      setInfoCardWidth(beside && rect.width > 0 ? Math.ceil(rect.width) : 0);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(infoCardEl);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, [infoCardEl]);

  /* The current user's effective move side:
     - a per-student grant wins (coach restricted this student to one colour),
     - else the class-wide side when it is explicitly on,
     - else, in a LIVE class, both colours — students share the board with the
       coach by default; the server remains the source of truth and validates
       every move,
     - else locked (class not live). */
  const myMoveSide = useMemo(() => {
    /* "Students move: Off" (the instructor's Stop all students button) is a
       hard stop for every student, grants included — the server rejects the
       move too, this only keeps the board from offering it. */
    if (classMeta?.studentInteractionEnabled === false) return null;
    const mine = (moveGrants || []).find((g) => g.userId === user?.id);
    if (mine?.moveSide) return mine.moveSide;
    if (classMeta?.studentInteractionEnabled) return classMeta?.studentMoveSide || 'both';
    if (classMeta?.status === 'live') return 'both';
    return null;
  }, [moveGrants, user, classMeta]);
  const canInteract = isInstructor || myMoveSide !== null;

  /* ── drill mode: a student solves the coach's puzzle on THIS board ──
     The board is normally one position broadcast to the whole room, so a drill
     cannot be solved on it as-is — every attempt would move everyone's pieces.
     So for the duration of a drill the board steps aside: it holds a PRIVATE
     copy of the puzzle position, validates attempts locally, emits nothing, and
     hands the class its own game back when the drill ends. That is what lets
     the "no separate drill card" instruction and the drill's per-student ledger
     (own attempts, own wrong moves, own points) coexist.

     `drill` = { fen, solution, interactive, onCorrectMove, onSolved, onFailed }.
     `interactive: false` means solved / out of time — still shown, not playable. */
  const drillActive = !!drill;
  const drillSolution = drill?.solution || [];
  const drillReady = drillActive && drill?.interactive !== false;
  /* `drill.nonce` changes when the student hits Retry, so it is part of the
     drill's identity: a retry re-arms the solver and drops the review position
     exactly the way a brand new puzzle does. */
  const drillKey = useMemo(
    () => (drillActive ? `${drill?.nonce ?? 0}|${drill?.fen || ''}` : null),
    [drillActive, drill?.nonce, drill?.fen],
  );
  /* Which ply the board is SHOWING. null = live, following the solve; a number =
     the student is reviewing an earlier move. The move list lives in
     PuzzleDrill and needs this same number, so it is reported up rather than
     owned in two places — the board stays the single source of truth. */
  const [drillViewPly, setViewPly] = useState(null);
  useEffect(() => { onDrillViewPly?.(drillViewPly); }, [drillViewPly, onDrillViewPly]);
  /* A drill that ends in checkmate keeps the board locked and its outcome
     badge hidden until the mating animation is over. */
  const [drillFinishing, setDrillFinishing] = useState(false);
  const drillRevealCancelRef = useRef(null);

  /* True when `state` is not newer than what this board already shows.
     A snapshot (join/boot) can be overtaken by live moves before React commits
     it, and an ack can arrive after a later move's echo; applying either would
     rewind the board. States without a revision (older server, or the HTTP
     boot) fall back to comparing half-move counts for snapshots only. */
  const isStaleState = useCallback((state, { snapshot = false } = {}) => {
    if (!state) return true;
    const last = lastBoardRevRef.current;
    const rev = Number.isFinite(state.rev) ? state.rev : null;
    if (rev != null && last && state.epoch && last.epoch === state.epoch) {
      return rev <= last.rev;
    }
    if (rev == null && snapshot) {
      const ply = Number.isFinite(state.ply)
        ? state.ply
        : (Array.isArray(state.moves) ? state.moves.length : null);
      return ply != null && ply < boardPlyRef.current;
    }
    return false;
  }, []);

  const rememberBoardRev = useCallback((state) => {
    if (Number.isFinite(state?.rev) && state?.epoch) {
      lastBoardRevRef.current = { epoch: state.epoch, rev: state.rev };
    }
  }, []);

  /* Apply an authoritative state to the local instance (skip if identical). */
  const applyAuthoritative = useCallback((state) => {
    const liveGame = gameRef.current;
    if (!liveGame) return;
    busyRef.current = true;
    let positionChanged = false;
    try {
      if (state.pgn && String(state.pgn).trim().length > 0) {
        if (liveGame.pgn() !== state.pgn) { liveGame.loadPgn(state.pgn, { strict: false }); positionChanged = true; }
      } else if (state.fen && liveGame.fen() !== state.fen) {
        liveGame.load(state.fen);
        positionChanged = true;
      }
      /* A position loaded from the server (new game, load FEN/PGN, undo, a
         drill hand-off) replaces the move any effect belonged to. An echo of
         the position we already show changes nothing and keeps its effect. */
      if (positionChanged) clearMoveEffects('live-position');
      boardPlyRef.current = liveGame.history().length;
      setFen(liveGame.fen());
      setMoves(liveGame.history().slice());
      setLastMove(state?.lastMove || null);
      // any authoritative position change instantly clears the engine suggestion
      setBestArrow(null);
    } catch (e) {
      /* A malformed PGN must never wipe the board (it used to reset to the
         starting position). Fall back to the FEN in the same payload and, if
         even that is unusable, keep the current position until the next
         authoritative update. */
      console.warn('[live-board] could not apply authoritative state:', e?.message);
      try {
        if (state.fen && liveGame.fen() !== state.fen) liveGame.load(state.fen);
        boardPlyRef.current = liveGame.history().length;
        setFen(liveGame.fen());
        setMoves(liveGame.history().slice());
        setLastMove(state?.lastMove || null);
        setBestArrow(null);
      } catch (_) { /* keep what is on screen */ }
    } finally {
      busyRef.current = false;
    }
  }, []);

  /* When the context chessState changes (the HTTP boot, then every join and
     reconnect snapshot), apply it unless the board has already moved past it.
     The board is single-sourced from the server: this also picks up the moves
     a reconnecting student missed while their socket was down. */
  useEffect(() => {
    const incomingFen = chessState?.fen;
    if (!incomingFen) return;
    if (drillActive) {
      /* Drill in progress: the class game keeps getting played, so keep the
         newest position parked for the hand-back rather than dropping it. */
      classFenRef.current = incomingFen;
      return;
    }
    if (isStaleState(chessState, { snapshot: true })) return;
    if (appliedFenRef.current !== incomingFen) {
      applyAuthoritative(chessState);
      appliedFenRef.current = incomingFen;
    }
    rememberBoardRev(chessState);
    classFenRef.current = incomingFen;
    if (chessState.moves) setMoves(chessState.moves);
    if (chessState.annotations) setAnnotations(chessState.annotations);
  }, [chessState, applyAuthoritative, drillActive, isStaleState, rememberBoardRev]);

  /* Set the last applied fen whenever fen changes from our own actions. */
  useEffect(() => {
    appliedFenRef.current = fen;
    // stale engine suggestion (local-only) no longer fits the new position
    setBestArrow(null);
  }, [fen]);

  /* ── socket subscriptions ── */
  /* Read by the handlers below so the subscriptions can be registered exactly
     once per class. Depending on `drillActive` instead re-subscribed on every
     drill start/end, which left a window where a live move reached no listener. */
  const drillActiveRef = useRef(drillActive);
  useEffect(() => { drillActiveRef.current = drillActive; }, [drillActive]);

  useEffect(() => {
    const offs = [
      on('chess_state_updated', (state) => {
        if (!state.fen) return;
        /* A live move, undo or fresh game supersedes any room-wide review: the
           class board is authoritative again. */
        setRemoteReview(null);
        /* Parked, not dropped: a drill owns the board, but the class keeps
           playing and the student must get that position back afterwards. */
        if (drillActiveRef.current) {
          classFenRef.current = state.fen;
          return;
        }
        /* Already applied (our own move's echo) or older than the board (a
           replayed update, or an ack for an earlier move): nothing to do. */
        if (isStaleState(state)) return;
        applyAuthoritative(state);
        rememberBoardRev(state);
        appliedFenRef.current = state.fen;
        classFenRef.current = state.fen;
        setFen((prev) => (prev !== state.fen ? state.fen : prev));
        if (state.lastMove) setLastMove(state.lastMove);
        busyRef.current = false;
      }),
      on('chess_review_updated', (rev) => {
        /* The instructor stepping through the game — shown on every board that
           has no private click of its own. to:null returns the room to live. */
        setRemoteReview(rev && rev.fen && rev.to != null ? rev : null);
      }),
      on('annotations_updated', ({ annotations: a }) => {
        if (a) setAnnotations(a);
      }),
      on('interaction_changed', ({ enabled }) => {
        patchPermissions({ canControlBoard: isInstructor || enabled });
        setClassMeta((prev) => (prev ? { ...prev, studentInteractionEnabled: enabled } : prev));
      }),
      on('move_side_changed', ({ side }) => {
        if (side) {
          setStudentMoveSide(side);
          setClassMeta((prev) => (prev ? { ...prev, studentMoveSide: side } : prev));
        }
      }),
      on('move_grant_changed', ({ userId: gUserId, side }) => {
        setMoveGrants((prev) => {
          const rest = (prev || []).filter((g) => g.userId !== gUserId);
          return side ? [...rest, { userId: gUserId, moveSide: side }] : rest;
        });
        /* A single-colour grant also orients the board: the student just given
           White should see White at the bottom without hunting for Flip. Only
           the granted student's own board moves (gUserId === me) - the
           instructor granting someone keeps whatever orientation they had.
           'both' and removal leave it alone, since there is no single colour
           to show. */
        if (Number(gUserId) === Number(user?.id) && (side === 'white' || side === 'black')) {
          setOrientation(side);
        }
      }),
      on('action_rejected', (payload) => {
        flash(payload?.reason || 'Action rejected');
      }),
      on('board_annotation', (payload) => {
        if (payload && payload.annotations) setAnnotations(payload.annotations);
      }),
      on('play_launch', () => {
        if (!isInstructor) setPlayOffer(true);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [applyAuthoritative, patchPermissions, isInstructor, user?.id, isStaleState, rememberBoardRev]);

  /* Hand the board between the two positions that can own it. Entering a drill
     loads a private copy of the puzzle; leaving one restores the class game,
     wherever it has got to while the student was solving.

     Keyed on the position the DRILL is, never on the board's own `fen`: this
     effect loads a position, so re-running it for a student's move would wipe
     the drill's history back to the puzzle start every single time — the board
     would snap back after each move and the solve could never get past move
     one. */
  useEffect(() => {
    if (drillKey !== drillFenRef.current) {
      /* A different drill (or a retry, or no drill) owns the board now: the
         solve starts from zero, whatever was on it before. */
      drillFenRef.current = drillKey;
      drillSolverRef.current = createSolver(drillSolution);
      setViewPly(null);
      clearDrillFeedback();
      if (drillActive && drill?.fen && appliedFenRef.current !== drill.fen) {
        applyAuthoritative({ fen: drill.fen, lastMove: null });
      }
      return undefined;
    }
    if (!drillActive && classFenRef.current && appliedFenRef.current !== classFenRef.current) {
      applyAuthoritative({ fen: classFenRef.current, lastMove: null });
    }
    return undefined;
  }, [drillKey, drillActive, drill?.fen, drillSolution, applyAuthoritative, clearDrillFeedback]);

  /* The line changing without the position changing (the coach re-asked the
     same position). Re-arm rather than keep judging against the old one. */
  useEffect(() => {
    if (drillActive && drillSolverRef.current.solution.join(' ') !== drillSolution.join(' ')) {
      drillSolverRef.current = createSolver(drillSolution);
      setViewPly(null);
    }
  }, [drillActive, drillSolution, setViewPly]);

  /* ── announce orientation changes (no server persistence for MVP) ── */
  const flip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'));

  const doMove = useCallback((move, game) => {
    // Optimistic local apply (also makes the board feel responsive before the broadcast echoes).
    const san = move?.san || '';
    if (busyRef.current) return;
    setBestArrow(null); // any move instantly clears the engine suggestion
    const optimisticFen = game.fen();
    setMoves(game.history().slice());
    setFen(optimisticFen);
    setLastMove({ from: move.from, to: move.to, san });
    const payload = { classId: classMeta.id, from: move.from, to: move.to, promotion: move.promotion };
    emit('chess_move', payload, (res) => {
      if (res && res.ok === false) {
        // server rejected → revert the optimistic move and reload the UI state
        flash(res.error || 'Illegal move');
        const liveGame = gameRef.current;
        /* Only undo if the board still shows OUR optimistic move. If another
           player's move broadcast arrived while this one was in flight, the
           board already holds the authoritative position and undoing it would
           delete their move. */
        if (liveGame && liveGame.fen() === optimisticFen) {
          try {
            liveGame.undo();
            setFen(liveGame.fen());
            setMoves(liveGame.history().slice());
            const history = liveGame.history({ verbose: true });
            const prevMove = history[history.length - 1] || null;
            setLastMove(prevMove ? { from: prevMove.from, to: prevMove.to, san: prevMove.san } : null);
          } catch (_) {
            setFen(liveGame.fen());
          }
        }
      } else if (res && res.broadcast && !isStaleState(res.broadcast)) {
        /* The room echo is the normal path (the sender is in the room too).
           This ack is the safety net for a move emitted in the instant a socket
           reconnects, before it has re-joined; a stale ack — its reply overtaken
           by a newer move's echo — must never rewind the board. */
        applyAuthoritative(res.broadcast);
        rememberBoardRev(res.broadcast);
        appliedFenRef.current = res.broadcast.fen;
        classFenRef.current = res.broadcast.fen;
      }
    });
  }, [classMeta.id, flash, applyAuthoritative, isStaleState, rememberBoardRev]);

  /* ── drill move handling ──
     The rules are the homework trainer's, from utils/puzzleSolve.js, so a puzzle
     is solved the same way on both surfaces: the defender's reply animates in on
     its own, a wrong move is VETOED so the board can never be stranded outside
     the line, and the drill ends when the line runs out. Nothing is emitted —
     this is a private solve on the class board's own instance. */
  const doDrillMove = useCallback((move, game) => {
    const g = gameRef.current;
    if (!g || !drillReady || drillSolution.length === 0) return;
    if (drillFinishing) return;               // the mating animation owns the board
    if (drillReplyTimerRef.current) return;   // a reply is still sliding in
    /* Reviewing an earlier move? Snap back to the live position first, or the
       next attempt would be judged against the ply being looked at. */
    if (drillViewPly !== null) setViewPly(null);

    const solver = drillSolverRef.current;
    const wasSolverTurn = solver.isSolverTurn();
    const result = solver.judge(move, g);

    if (result.status === 'wrong') {
      setFen(g.fen());
      setMoves(g.history().slice());
      setLastMove({ from: move.from, to: move.to, san: '' });
      /* Vetoed above, so the piece snaps back — the badge only announces it. */
      const fb = resolveMoveFeedback({ status: 'wrong', move, game: g });
      if (fb) showDrillFeedback(fb.type, fb.square, fb);
      /* The line INCLUDING the vetoed move: what the student tried, so the drill
         can record the attempt and the instructor can see what was guessed. */
      drill?.onFailed?.([...result.line, result.uci], result.san);
      return;
    }

    if (wasSolverTurn && drill?.onCorrectMove && move) {
      drill.onCorrectMove({
        from: move.from,
        to: move.to,
        pieceType: move.piece,
        color: move.color,
        san: move.san,
      }, result.line);
    }

    setFen(g.fen());
    setMoves(g.history().slice());
    setLastMove({ from: move.from, to: move.to, san: move.san });
    setBestArrow(null);

    /* Finishing drops any review, so the board shows the position that solved it. */
    if (result.status === 'solved') {
      setViewPly(null);
      const fb = resolveMoveFeedback({ status: 'solved', move, game: g });
      const showBadge = () => {
        drillRevealCancelRef.current = null;
        setDrillFinishing(false);
        if (fb) showDrillFeedback(fb.type, fb.square, { ...fb, points: drill?.points ?? 10 });
      };
      if (result.checkmate) {
        /* The outcome badge and the Retry card wait for the mating animation. */
        setDrillFinishing(true);
        if (drillRevealCancelRef.current) drillRevealCancelRef.current();
        drillRevealCancelRef.current = revealAfterCheckmate(
          { to: result.lastMove?.to },
          showBadge,
        );
      } else {
        showBadge();
      }
      drill?.onSolved?.(result.line, { checkmate: result.checkmate, lastMove: result.lastMove });
      return;
    }

    /* Correct but not finished: praise it (check/mate outrank praise). The
       badge is the drill board's single move-by-move popup. */
    {
      const fb = resolveMoveFeedback({ status: 'correct', move, game: g });
      if (fb) showDrillFeedback(fb.type, fb.square, fb);
    }

    /* The student's move is on the board. Now bring the defender's reply in a
     * beat later: react-chessboard slides a piece only when a position arrives
     * as an EXTERNAL change, and two plies in one commit is not one — so the
     * reply has to be its own change, after the first has painted. */
    if (!result.replyPending) return;
    drillReplyTimerRef.current = setTimeout(() => {
      drillReplyTimerRef.current = null;
      const replied = solver.applyReply(g);
      if (!replied.played) return;
      /* The reply only surfaces when it gives check/mate (quiet otherwise);
         a reply that finishes the line earns the Solved badge with points. */
      const fb = resolveMoveFeedback({
        status: replied.solved ? 'solved' : 'correct',
        move: replied.lastMove,
        game: g,
        isReply: !replied.solved,
      });
      const showReplyBadge = () => {
        drillRevealCancelRef.current = null;
        setDrillFinishing(false);
        if (fb) showDrillFeedback(fb.type, fb.square, replied.solved ? { ...fb, points: drill?.points ?? 10 } : fb);
      };
      if (fb && replied.solved && replied.checkmate) {
        setDrillFinishing(true);
        if (drillRevealCancelRef.current) drillRevealCancelRef.current();
        drillRevealCancelRef.current = revealAfterCheckmate(
          { to: replied.lastMove?.to },
          showReplyBadge,
        );
      } else {
        showReplyBadge();
      }
      setFen(g.fen());
      setMoves(g.history().slice());
      setLastMove({ from: replied.lastMove.from, to: replied.lastMove.to, san: replied.san });
      setDrillReplying((n) => n + 1);
      if (replied.solved) {
        setViewPly(null);
        drill?.onSolved?.(replied.line, { checkmate: replied.checkmate, lastMove: replied.lastMove });
      }
    }, MOVE_ANIM_MS);
  }, [drillReady, drillSolution, drill, drillViewPly, drillFinishing, setViewPly, showDrillFeedback]);

  /* A pending reply must not survive the drill it belonged to, or it fires into
     the next puzzle — or into the class game. */
  useEffect(() => () => {
    if (drillReplyTimerRef.current) clearTimeout(drillReplyTimerRef.current);
    drillReplyTimerRef.current = null;
    if (drillRevealCancelRef.current) {
      drillRevealCancelRef.current();
      drillRevealCancelRef.current = null;
    }
  }, [drillKey]);
  /* A retry (new drillKey) re-arms the board immediately. */
  useEffect(() => { setDrillFinishing(false); }, [drillKey]);

  /* Jump the board to an earlier ply of the solve (a click on the move list).
     A separate Chess instance: rewinding the LIVE board would desynchronise the
     solver, and the next attempt has to be judged from where the solve really
     is. Re-entering the live position just closes the review. */
  const drillReviewFen = useMemo(() => {
    if (!drillActive || drillViewPly == null || !drill?.fen) return null;
    return fenAtPly(drill.fen, drillSolution, drillViewPly);
  }, [drillActive, drillViewPly, drill?.fen, drillSolution]);

  /* ── live-game review ──────────────────────────────────────────────────────
     A click in the Move history sets the shared `viewIndex` (context) to the
     move being studied; null means live. The position is rebuilt on a
     THROWAWAY Chess instance built from a CLONE of the live game's PGN — which
     carries a [FEN] header when the class started from a custom position — so
     the live `gameRef`, which the mover, the engine and the next broadcast all
     read, is never rewound. Keyed on `moves` so it recomputes as the game grows. */
  const classReview = useMemo(() => {
    if (drillActive || viewIndex == null || moves.length === 0) return null;
    const liveGame = gameRef.current;
    if (!liveGame) return null;
    let g;
    try {
      g = new Chess();
      const pgn = liveGame.pgn();
      if (pgn && pgn.trim()) g.loadPgn(pgn, { strict: false });
      else g.load(liveGame.fen());
    } catch { return null; }
    const upto = Math.min(viewIndex + 1, g.history().length);
    while (g.history().length > upto) g.undo();
    const history = g.history({ verbose: true });
    const last = history[history.length - 1];
    return { fen: g.fen(), lastMove: last ? { from: last.from, to: last.to, san: last.san } : null };
  }, [drillActive, viewIndex, moves]);

  /* The room-wide review the INSTRUCTOR is leading, pushed by the server. It is
     what every other viewer's board follows while they have no private click of
     their own (`viewIndex`). null = no room-wide review. */
  const remoteReviewBoard = useMemo(() => {
    if (drillActive || !remoteReview || !remoteReview.fen || remoteReview.to == null) return null;
    return { fen: remoteReview.fen, lastMove: remoteReview.lastMove || null, to: remoteReview.to };
  }, [drillActive, remoteReview]);

  /* The still position the board shows while reviewing ANY history — a drill
     ply, the instructor's own step-back, or the room-wide ply they lead. Kept as
     one value so a SINGLE <ChessBoard> instance can render both the live game
     and a review, and is never remounted on navigation. Remounting it (the old
     per-fen `key`) is what made the whole board blink on every click. */
  const reviewFen = drillReviewFen
    || (classReview ? classReview.fen : null)
    || (remoteReviewBoard ? remoteReviewBoard.fen : null);
  const reviewLastMove = (classReview && classReview.lastMove)
    || (remoteReviewBoard && remoteReviewBoard.lastMove)
    || null;
  const reviewing = Boolean(reviewFen);
  /* A controlled stand-in for the reviewed position: rendering it through the
     same `game` prop the live board uses keeps the board mounted (no controlled/
     uncontrolled flip, no stale first frame) and paints the right position on
     the very first render. */
  const reviewGame = useMemo(() => {
    if (!reviewFen) return null;
    try { return new Chess(reviewFen); } catch { return new Chess(); }
  }, [reviewFen]);

  /* Stepping to another ply shows a different position, so an engine suggestion
     that belonged to the previous one must not linger on the new board. */
  useEffect(() => { setBestArrow(null); }, [reviewFen]);

  /* The shared history can outrun the ply being viewed (a live move arrives, a
     new game replaces it). A review that no longer points INSIDE the game is
     over, whether or not the viewer pressed anything. */
  useEffect(() => {
    if (viewIndex != null && (moves.length === 0 || viewIndex >= moves.length)) setViewIndex(null);
  }, [viewIndex, moves.length, setViewIndex]);

  /* A drill takes the board over for the whole solve, so a review of the CLASS
     game cannot stay open across it. */
  useEffect(() => { if (drillActive) setViewIndex(null); }, [drillActive, setViewIndex]);

  /* When the instructor steps back, the room follows: each change of the viewed
     ply is pushed to the server, which echoes it to every board as
     `chess_review_updated`. Students have no Prev/Next — only their own private
     click — so only the instructor's navigation is broadcast. `ref` seeded to
     null so mounting on the live position does not fire a needless broadcast. */
  const reviewEmitRef = useRef(null);
  useEffect(() => {
    if (!isInstructor) return;
    if (reviewEmitRef.current === viewIndex) return;
    reviewEmitRef.current = viewIndex;
    if (drillActive) return;
    emit('chess_control', { classId: classMeta.id, action: 'navigate', payload: { to: viewIndex } }, () => {});
  }, [isInstructor, drillActive, viewIndex, classMeta.id]);

  const handleBoardMove = useCallback((move, game) => {
    /* A drill owns the board: validate the attempt locally and emit nothing. */
    if (drillActive) {
      doDrillMove(move, game);
      return;
    }
    /* A student browsing an earlier ply of a solved drill is looking at a
     * still image — the next attempt must start from the live position. */
    if (drillViewPly !== null) setViewPly(null);
    if (!canInteract) return;
    if (!isInstructor && myMoveSide !== 'both') {
      const turnColor = gameRef.current?.turn() === 'w' ? 'white' : 'black';
      if (turnColor !== myMoveSide) {
        flash(`You can move ${myMoveSide} pieces only`);
        return;
      }
    }
    setRedoCount(0);
    doMove(move, game);
  }, [canInteract, isInstructor, myMoveSide, doMove, flash, drillActive, doDrillMove]);

  /* ── instructor controls ── */
  const sendControl = useCallback((action, payload, onDone) => {
    emit('chess_control', { classId: classMeta.id, action, payload }, (res) => {
      if (res && res.ok === false) flash(res.error || 'Action failed');
      else if (res && res.broadcast && !isStaleState(res.broadcast)) {
        /* Same rule as a move ack: the room echo is the normal path, and a
           reply that was overtaken by a newer board state is ignored. */
        applyAuthoritative(res.broadcast);
        rememberBoardRev(res.broadcast);
        appliedFenRef.current = res.broadcast.fen;
        classFenRef.current = res.broadcast.fen;
      }
      if (onDone) onDone(res);
    });
  }, [classMeta.id, flash, applyAuthoritative, isStaleState, rememberBoardRev]);

  const handleUndo = useCallback(() => {
    if (moves.length === 0) return;
    sendControl('undo', {}, (res) => {
      if (res && res.ok === true) setRedoCount((c) => c + 1);
    });
  }, [sendControl, moves.length]);

  const handleRedo = useCallback(() => {
    if (redoCount === 0) return;
    sendControl('redo', {}, (res) => {
      if (res && res.ok === true) setRedoCount((c) => Math.max(0, c - 1));
    });
  }, [sendControl, redoCount]);

  /* ◀ Prev / ▶ Next step the REVIEW back and forward through the same history
     the move list shows — a local rewind, never a broadcast. ▶ landing on the
     last move (or from live, where there is nowhere forward to go) returns to
     the live position, which is what `null` encodes. ◀ walks all the way down
     to `-1`, the position BEFORE the first move (the starting position) — the
     old floor of 0 stranded the start, so a one-move game could not step back
     at all. */
  const viewPrev = useCallback(() => {
    if (drillActive || moves.length === 0) return;
    setViewIndex((cur) => {
      const base = cur == null ? moves.length - 1 : cur;
      return Math.max(-1, base - 1);
    });
  }, [drillActive, moves.length, setViewIndex]);

  const viewNext = useCallback(() => {
    if (drillActive || moves.length === 0) return;
    setViewIndex((cur) => {
      if (cur == null) return null;                       // already live
      const next = cur + 1;
      return next >= moves.length - 1 ? null : next;      // the last move is live
    });
  }, [drillActive, moves.length, setViewIndex]);

  /* The board is off the live position: either the instructor's own step-back,
     or the room-wide review they are leading. */
  const viewingPast = classReview != null || remoteReviewBoard != null;
  const canViewPrev = !drillActive && moves.length > 0 && viewIndex !== -1;
  const canViewNext = !drillActive && moves.length > 0 && viewIndex != null;

  /* ── keyboard shortcuts ──
     ←/→ step the REVIEW through the move history, resuming from whatever move
     was last selected (a click in the list, or the previous arrow). They are
     deliberately NOT undo/redo: undoing from the keyboard would delete a real
     move from the shared history — the list the instructor is reading would
     shrink out from under them. Undo/redo stay on the modifier keys
     (Ctrl/Cmd+Z, Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z). Only the instructor scrubs the
     class game; students read the list. */
  useEffect(() => {
    const onKeyDown = (e) => {
      /* Same reason the buttons step aside: replaying moves would desynchronise
         a drill's move count from its solution line. */
      if (drillActive) return;
      if (!permissions.canControlBoard) return;
      const leaking = e.target &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (leaking) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (!isInstructor) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') viewPrev();
        else viewNext();
        return;
      }
      if (!mod || e.altKey) return;
      const key = (e.key || '').toLowerCase();
      if (key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [permissions.canControlBoard, handleUndo, handleRedo, drillActive, isInstructor, viewPrev, viewNext]);

  /* ── engine-assisted best move ── */
  /* The exact position the board is DISPLAYING: the live game, or the ply being
     reviewed. "Best move" must reason about what the instructor is looking at —
     otherwise, having stepped into a pasted game, it would silently analyse the
     hidden live tail and draw the arrow off the visible board. */
  const shownFen = reviewing && reviewFen ? reviewFen : fen;
  const shownFenRef = useRef(shownFen);
  useEffect(() => { shownFenRef.current = shownFen; }, [shownFen]);

  /* no legal moves for the side to move (mate/stalemate/etc.) — button disabled */
  const noLegalMoves = useMemo(() => {
    try {
      const shown = reviewing ? reviewGame : gameRef.current;
      return (shown?.moves({ verbose: false }) || []).length === 0;
    } catch {
      return true;
    }
  }, [reviewing, reviewGame, fen]);

  const handleBestMove = useCallback(async () => {
    if (bestThinking) return;
    const shown = reviewing ? reviewGame : gameRef.current;
    if (!shown || noLegalMoves) {
      flash('No moves available.');
      return;
    }
    setBestThinking(true);
    try {
      // Stockfish evaluates from the current side-to-move's perspective — the
      // same call works for White or Black, no special-casing needed.
      const startFen = shown.fen();
      const res = await searchBest(startFen, { maxDepth: 12, timeMs: 2000 });
      if (!res) {
        flash('No moves available.');
        return;
      }
      // The board may have moved on while the engine was thinking — never show a
      // suggestion for a position the instructor is no longer looking at.
      if (shownFenRef.current !== startFen) return;
      // Only show a gold arrow toward the suggested move — nothing is played.
      // This is a local-only overlay (instructor's side), NOT broadcast to
      // students. Repeated clicks replace the previous suggestion.
      setBestArrow({ from: res.from, to: res.to, color: '#fbbf24' });
      flash(`Best move suggestion: ${res.from}→${res.to}`);
    } catch {
      flash('Engine unavailable.');
    } finally {
      setBestThinking(false);
    }
  }, [bestThinking, noLegalMoves, flash, reviewing, reviewGame]);

  /* ── 🤖 Computer vs Students ────────────────────────────────────────────
     The instructor switches on a bot side: whenever it is the bot's turn on
     the shared board, Stockfish plays for it. Students reply on the shared
     board (when interaction is on) just like a normal game, so the whole class
     plays TOGETHER against the computer. The watch panel below shows the game
     as drill-style SAN chips (green = bot moves). */
  const botActive = botArmed && botSide !== null;

  const isItBotsTurn = useMemo(() => {
    if (!botSide) return false;
    const g = gameRef.current;
    if (!g) return false;
    const botColor = botSide === 'white' ? 'black' : 'white';
    return (g.turn() === 'w' ? 'white' : 'black') === botColor && !g.isGameOver();
  }, [botSide, fen]); // eslint-disable-line react-hooks/exhaustive-deps

  const botResult = useMemo(() => {
    const g = gameRef.current;
    if (!g || !g.isGameOver()) return null;
    if (g.isCheckmate()) return `${g.turn() === 'w' ? 'Black' : 'White'} checkmates`;
    if (g.isStalemate()) return 'Stalemate — draw';
    if (g.isThreefoldRepetition()) return 'Draw — repetition';
    if (g.isInsufficientMaterial()) return 'Draw — insufficient material';
    return 'Game over';
  }, [fen]); // eslint-disable-line react-hooks/exhaustive-deps

  const playBotMove = useCallback(async () => {
    if (botThinking) return;
    const g = gameRef.current;
    if (!g || !botSide || g.isGameOver() || !isItBotsTurn) return;
    setBotThinking(true);
    try {
      const cfg = botLevelConfig(botLevel);
      const res = await searchBest(g.fen(), {
        maxDepth: cfg.maxDepth,
        timeMs: cfg.timeMs,
        skillLevel: cfg.skillLevel,
      });
      const g2 = gameRef.current;
      if (!res || g2.isGameOver()) return;
      let mv;
      try {
        mv = g2.move({ from: res.from, to: res.to, promotion: res.promotion });
      } catch {
        return;
      }
      if (!mv) return;
      doMove({ from: mv.from, to: mv.to, san: mv.san, promotion: mv.promotion }, g2);
    } catch {
      flash('Engine unavailable.');
    } finally {
      setBotThinking(false);
    }
  }, [botThinking, botSide, isItBotsTurn, doMove, flash, botLevel]);

  /* Auto-play: whenever the shared position settles on the bot's turn while
     auto-play is on, schedule the bot's move (only the instructor computes). */
  useEffect(() => {
    if (botTimerRef.current) {
      window.clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    if (!isInstructor || !botActive || !botAuto || botThinking || !isItBotsTurn) return;
    botTimerRef.current = window.setTimeout(() => {
      playBotMove();
    }, 900);
    return () => {
      if (botTimerRef.current) {
        window.clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    };
  }, [fen, botActive, botAuto, botThinking, isItBotsTurn, isInstructor, playBotMove]);

  /* SAN chips for the watch panel — green for the bot's moves (by move index). */
  const botWatchChips = useMemo(() => {
    if (!moves.length) return [];
    return moves.map((san, i) => {
      const mover = i % 2 === 0 ? 'white' : 'black';
      return { san, num: Math.floor(i / 2) + 1, isBot: (botSide === 'white' ? 'black' : 'white') === mover };
    });
  }, [moves, botSide]);

  /* Drawn arrows: bright light green at 70% transparency. One constant for the
     local draw and the broadcast so the instructor's line and every student's
     copy cannot drift apart — they arrive via separate code paths. */
const DRAWN_ARROW_COLOR = 'rgba(0, 255, 0, 0.7)';

  /* ── annotation drawing ── */

  /* Arrow drawing is fully custom (ChessBoard's arrowTool): react-chessboard's
     built-in arrow state wipes on every customArrows change, which used to drop
     previously drawn lines. Each finished drag emits ONE add_arrow, so any
     number of lines accumulate and broadcast live to everyone.
     `source === 'touch'` (the mobile long-press drag) TOGGLES instead: drawing
     the same arrow again removes it. Mouse/right-drag keeps its add-only
     behaviour, so the desktop experience is untouched. */
  const handleArrowDrawn = useCallback((from, to, source) => {
    const arrows = annotations?.arrows || [];
    if (source === 'touch' && arrows.some((a) => a.from === from && a.to === to)) {
      const updated = { ...annotations, arrows: arrows.filter((a) => !(a.from === from && a.to === to)) };
      annotationsRef.current = updated;
      setAnnotations(updated);
      emit('board_annotation', { classId: classMeta.id, type: 'remove_arrow', data: { from, to } });
      return;
    }
    const next = {
      ...annotations,
      arrows: [...arrows, { from, to, color: DRAWN_ARROW_COLOR }],
    };
    annotationsRef.current = next;
    setAnnotations(next);
    emit('board_annotation', { classId: classMeta.id, type: 'add_arrow', data: { from, to, color: DRAWN_ARROW_COLOR } });
  }, [annotations, classMeta.id]);

  /* plain RIGHT-click on a square fills the WHOLE square with a colour —
     clicking the same square with the same colour removes it, a different
     colour recolours it. The colour comes from the modifier keys held at
     click time (see utils/liveHighlights). Broadcasts to the whole room,
     colour included so students render the identical fill. The emit stays
     OUTSIDE the state updater: updaters must stay pure (React StrictMode
     invokes them twice in dev, which would double-broadcast). */
  const handleSquareRightClick = useCallback((sq, modifiers) => {
    if (!permissions.canDrawAnnotations) return;
    const color = highlightColorForModifiers(modifiers);
    const prev = annotationsRef.current || annotations;
    const { highlights, action } = toggleHighlight(prev?.highlights, sq, color);
    const updated = { arrows: prev?.arrows || [], highlights };
    annotationsRef.current = updated;
    setAnnotations(updated);
    emit('board_annotation', {
      classId: classMeta.id,
      type: action === 'remove' ? 'remove_highlight' : 'add_highlight',
      data: { square: sq, color },
    });
  }, [permissions.canDrawAnnotations, annotations, classMeta.id]);

  /* plain LEFT-click on the board clears EVERYTHING — arrows and the square
     fills — and broadcasts to the room. */
  const handleClearAnnotations = useCallback(() => {
    const updated = { arrows: [], highlights: [] };
    annotationsRef.current = updated;
    setAnnotations(updated);
    emit('board_annotation', { classId: classMeta.id, type: 'clear_annotations' });
  }, [classMeta.id]);

  const handleAdminPlay = useCallback(() => {
    emit('play_launch', { classId: classMeta.id }, (res) => {
      if (res && res.ok === false) flash(res.error || 'Could not signal students');
    });
  }, [classMeta.id, flash]);

  /* ── 👥 Add students — invite class members mid-session ────────────────
     The instructor picks which students (not yet in the room) to invite via
     socket, and each invited student gets a live "join now" toast that drops
     them straight into /live-class/:id. */
  const openInviteCard = useCallback(() => {
    setInviteOpen(true);
    setSelectedInviteStudents([]);
    setInviteLoading(true);
    setInviteStudents([]);
    try {
      api
        .get(`/classes/${classMeta.id}/inviteable-students`, { cache: false })
        .then((res) => {
          setInviteStudents(Array.isArray(res.data) ? res.data : []);
        })
        .catch(() => setInviteStudents([]))
        .finally(() => setInviteLoading(false));
    } catch {
      setInviteLoading(false);
      setInviteStudents([]);
    }
  }, [classMeta.id]);

  const toggleInviteStudent = useCallback((userId) => {
    setSelectedInviteStudents((prev) =>
      prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]
    );
  }, []);

  const sendInvites = useCallback(() => {
    if (inviteSending || selectedInviteStudents.length === 0) return;
    setInviteSending(true);
    emit('invite_students', { classId: classMeta.id, userIds: selectedInviteStudents }, (res) => {
      setInviteSending(false);
      if (res && res.ok === false) {
        flash(res.error || 'Could not send invites');
        return;
      }
      setInviteOpen(false);
      flash(`Invite sent to ${selectedInviteStudents.length} student${selectedInviteStudents.length === 1 ? '' : 's'}`);
    });
  }, [inviteSending, selectedInviteStudents, classMeta.id, flash]);

  const handleStudentPlay = useCallback(() => {
    setPlayOffer(false);
    navigate('/student/analysis');
  }, [navigate]);

  /* ── Position panel: FEN or PGN ────────────────────────────────────────────
     The button used to open a bare window.prompt that only took a FEN. A PGN
     is the more useful paste (it carries the whole game, so the move list and
     undo/redo survive), so the panel now accepts either, tells the instructor
     which it detected, and reports exactly what is wrong when a paste does not
     parse. FEN goes through `load_fen`; PGN through `load_pgn`, which replays
     the game on the server so every viewer gets the same move history. */
  const posKind = useMemo(() => detectNotation(posText), [posText]);
  const posGames = useMemo(() => (posKind === 'pgn' ? splitPgnGames(posText) : []), [posKind, posText]);
  useEffect(() => { setPosGameIndex(0); }, [posGames.length]);
  const posDetectedLabel = posKind === 'fen'
    ? 'FEN'
    : posKind === 'pgn'
      ? (posGames.length > 1 ? `PGN · ${posGames.length} games` : 'PGN')
      : '';

  const openPositionPanel = useCallback(() => {
    setPosText('');
    setPosError('');
    setPosGameIndex(0);
    setPosOpen(true);
  }, []);

  const handleLoadPosition = useCallback(() => {
    const text = posText.trim();
    if (!text) {
      setPosError('Paste a FEN or a PGN to load.');
      return;
    }
    if (detectNotation(text) === 'fen') {
      const loaded = tryLoadFen(text);
      if (!loaded) {
        setPosError('Invalid FEN — check the position string.');
        return;
      }
      setRedoCount(0);
      setViewIndex(null);
      sendControl('load_fen', { fen: loaded.fen });
      setPosOpen(false);
      return;
    }
    const games = splitPgnGames(text);
    const chosen = games[posGameIndex] ?? games[0];
    if (!tryLoadPgn(chosen)) {
      setPosError('Invalid PGN — check the move text.');
      return;
    }
    setRedoCount(0);
    setViewIndex(null);
    sendControl('load_pgn', { pgn: chosen });
    setPosOpen(false);
    flash(games.length > 1 ? `Loaded game ${posGameIndex + 1}` : 'Loaded game');
  }, [posText, posGameIndex, sendControl, flash, setViewIndex]);

  const copyCurrentFen = useCallback(async () => {
    const ok = await copyText(gameRef.current?.fen() || START_FEN);
    flash(ok ? 'Current FEN copied' : 'Could not copy FEN');
  }, [flash]);

  const copyCurrentPgn = useCallback(async () => {
    const ok = await copyText(gameRef.current?.pgn() || '');
    flash(ok ? 'Current PGN copied' : 'Could not copy PGN');
  }, [flash]);

  /* highlight square styles from annotations — a full-square, edge-to-edge
     semi-transparent fill (no circle, no ring); the piece on top stays visible
     because the square element sits under the piece layer. */
  const extraStyles = useMemo(
    () => highlightsToSquareStyles(annotations?.highlights),
    [annotations]
  );

  const turnLabel = useMemo(() => {
    const liveGame = gameRef.current;
    return liveGame ? (liveGame.turn() === 'w' ? 'White to move' : 'Black to move') : '';
  }, [fen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`live-board-wrap${toolsOpen ? ' live-tools-open' : ''}${isInstructor ? ' live-tools-docked' : ' live-tools-student'}`} ref={wrapRef} onClickCapture={handleBoardClick}>
        <div className="live-board-header">
          <div className="live-board-title">
            <span className="live-board-header-label">Shared Board</span>
            <span className="live-board-turn">{turnLabel}</span>
            {remoteReviewBoard && classReview == null && !isInstructor && (
              <span
                className="live-chip live-board-reviewing"
                title="The instructor is reviewing an earlier move — your board follows"
              >
                ⏵ Instructor reviewing
              </span>
            )}
            {isInstructor && (
              <button
                type="button"
                className={`live-chip live-icobtn live-board-tools-btn ${toolsOpen ? 'live-chip-on' : ''}`}
                onClick={() => setToolsOpen((v) => !v)}
                title="More tools"
                aria-label="More tools"
              >⋯</button>
            )}
          </div>
          <div className="live-board-caption">
            {!viewingPast && (
              <>
                {drillActive
                  ? (drillReady ? 'Solve the coach’s puzzle — find the right moves' : 'Drill finished — no more moves')
                  : canInteract
                    ? isInstructor
                      ? classMeta?.studentInteractionEnabled
                        ? `You move · students move ${studentMoveSide === 'both' ? 'either side' : studentMoveSide}`
                        : 'You can move the pieces'
                      : myMoveSide === 'both'
                        ? 'You can move the pieces'
                        : myMoveSide
                          ? `You can move ${myMoveSide} pieces`
                          : 'You can move the pieces'
                    : classMeta?.studentInteractionEnabled === false
                      ? 'Student moves are off — the coach has the board'
                      : 'Viewing instructor demo'}
                {drillActive
                  ? ' · your own attempts — the class board is untouched'
                  : !permissions.canDrawAnnotations && ' · annotations view-only'}
              </>
            )}
          </div>
        </div>

        <div className="live-board-body" ref={stageRef}>
          {/* The student's drill card, on the board's LEFT inside the stage so
              the fit above measures it (see infoCardWidth). CSS drops it under
              the board on a narrow screen, where it must not take width. */}
          {drillStatus && (
            <div className="live-drill-info" ref={infoCardRef}>{drillStatus}</div>
          )}
          <div className="live-board-maincol">
            <div className="live-board-canvas">
              <div className="live-board-inline" ref={fitRef}>
                {/* ONE board for both the live game and any review. Switching
                    branches — or keying it per-FEN, as before — unmounted and
                    remounted the whole board on every click, which read as a
                    blink across the page. The same instance now stays mounted and
                    only its props change, so stepping through moves is an
                    instant, silent swap: no remount, no animation, no move cue,
                    and the reviewed move is highlighted via `lastMove`. */}
                <div className="live-board-sizer">
                  <ChessBoard
                    game={reviewing ? reviewGame : gameRef.current}
                    fen={reviewing ? reviewFen : fen}
                    interactive={reviewing
                      ? false
                      : drillActive
                        ? (drillReady && !drillReplying && !drillFinishing)
                        : canInteract
                          && (isInstructor || myMoveSide === 'both'
                            || (gameRef.current?.turn() === 'w' ? 'white' : 'black') === myMoveSide)}
                    onMove={reviewing ? undefined : handleBoardMove}
                    orientation={orientation}
                    boardWidth={boardSize}
                    animationDuration={MOVE_ANIM_SECONDS}
                    soundOn={reviewing ? false : undefined}
                    showLegalMoves={reviewing ? false : (drillActive ? (drillReady && !drillReplying && !drillFinishing) : canInteract)}
                    customArrows={reviewing
                      ? (bestArrow ? [bestArrow] : [])
                      : (bestArrow ? [...(annotations?.arrows || []), bestArrow] : annotations?.arrows || [])}
                    allowNativeArrows={false}
                    arrowPreviewColor={reviewing ? undefined : DRAWN_ARROW_COLOR}
                    onArrowDrawn={reviewing ? undefined : (permissions.canDrawAnnotations ? handleArrowDrawn : undefined)}
                    onSquareRightClick={reviewing ? undefined : (permissions.canDrawAnnotations ? handleSquareRightClick : undefined)}
                    onClearArrows={reviewing ? undefined : (permissions.canDrawAnnotations ? handleClearAnnotations : undefined)}
                    lastMove={reviewing ? reviewLastMove : lastMove}
                    extraSquareStyles={reviewing ? undefined : extraStyles}
                  />
                  {!reviewing && (
                    <div
                      className="live-board-resize"
                      title="Drag to resize the board • double-click to auto-fit"
                      style={{ display: resizeHandleVisible ? 'grid' : 'none' }}
                      onPointerDown={resizePointerDown}
                      onPointerMove={resizePointerMove}
                      onDoubleClick={resetBoardSize}
                    >⤢</div>
                  )}
                  {!reviewing && toast && <div className="live-board-toast">{toast}</div>}
                  {!reviewing && drillActive && (
                    <MoveFeedbackOverlay feedback={drillFeedback} orientation={orientation} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Student Board tools card: a fixed panel docked RIGHT of the board —
            always visible, never a toggle or overlay — with the same titled
            "Board tools" look as the instructor rail. Holds Expand, Flip, and
            (when they apply) the play offer and undo/redo. */}
        {!isInstructor && (
          <div className="live-board-side live-board-side-student" aria-label="Board tools">
            <div className="live-board-side-head">
              <span className="live-board-side-title">Board tools</span>
            </div>
            <div className="live-board-grid">
              <button
                type="button"
                className={`live-chip live-icobtn has-label ${resizeHandleVisible ? 'live-chip-on' : ''}`}
                onClick={() => {
                  setResizeHandleVisible((v) => {
                    const next = !v;
                    try { localStorage.setItem('liveBoardResizeHandle', next ? '1' : '0'); } catch (_) {}
                    return next;
                  });
                }}
                title="Show/hide the board resize handle"
                aria-label="Show/hide the board resize handle"
              >
                <span aria-hidden="true">⤢</span>
                <span className="live-tool-label">Expand</span>
              </button>
              <button type="button" className="live-icobtn has-label" onClick={flip} title="Flip board" aria-label="Flip board"><span aria-hidden="true">⇅</span><span className="live-tool-label">Flip board</span></button>
            </div>
            {!isInstructor && playOffer && (
              <div className="live-play-offer">
                <span className="live-play-offer-txt">Coach wants you to play! 🎮</span>
                <Button
                  type="button"
                  variant="primary" size="sm"
                  onClick={handleStudentPlay}
                  title="Open the Play Arena"
                >
                  ▶ Play in Arena
                </Button>
              </div>
            )}
            {/* No Prev/Next for students: stepping through a game is the
                instructor's job, and their board follows it automatically. A
                student may still click a move in the list for a private look. */}
          </div>
        )}

        {isInstructor && (
        <div className="live-board-side">
          <div className="live-board-side-head">
            <span className="live-board-side-title">Board tools</span>
            <button type="button" className="live-board-side-x" onClick={() => setToolsOpen(false)} aria-label="Close tools">✕</button>
          </div>
          <div className="live-board-grid">
            <button
              type="button"
              className={`live-chip live-icobtn has-label ${resizeHandleVisible ? 'live-chip-on' : ''}`}
              onClick={() => {
                setResizeHandleVisible((v) => {
                  const next = !v;
                  try { localStorage.setItem('liveBoardResizeHandle', next ? '1' : '0'); } catch (_) {}
                  return next;
                });
              }}
              title="Show/hide the board resize handle"
              aria-label="Show/hide the board resize handle"
            >
              <span aria-hidden="true">⤢</span>
              <span className="live-tool-label">Expand</span>
            </button>
            {isInstructor && (
              <button
                type="button"
                className="live-chip live-icobtn has-label"
                onClick={handleAdminPlay}
                title="Signal the students to open their Play Arena"
                aria-label="Signal the students to open their Play Arena"
              >
                <span aria-hidden="true">🎮</span>
                <span className="live-tool-label">Games</span>
              </button>
            )}
            {!isInstructor && playOffer && (
              <div className="live-play-offer">
                <span className="live-play-offer-txt">Coach wants you to play! 🎮</span>
                <Button
                  type="button"
                  variant="primary" size="sm"
                  onClick={handleStudentPlay}
                  title="Open the Play Arena"
                >
                  ▶ Play in Arena
                </Button>
              </div>
            )}
            {/* New game / Load FEN / Setup reset the shared position for the
                whole room, so they too step aside while a drill owns the board. */}
            {permissions.canControlBoard && !drillActive && (
              <>
                <button type="button" className="live-icobtn has-label" onClick={() => { setRedoCount(0); setViewIndex(null); sendControl('new_game'); }} title="New Game" aria-label="New Game"><span aria-hidden="true">♟</span><span className="live-tool-label">New game</span></button>
                <button type="button" className="live-icobtn has-label" onClick={openPositionPanel} title="Load a FEN or PGN" aria-label="Load a FEN or PGN"><span aria-hidden="true">⎘</span><span className="live-tool-label">Position</span></button>
                <button type="button" className="live-icobtn has-label" onClick={() => setSetupOpen(true)} title="Setup Board" aria-label="Setup Board"><span aria-hidden="true">⚙</span><span className="live-tool-label">Settings</span></button>
              </>
            )}
            {isInstructor && (
              <button
                type="button"
                className={`live-icobtn has-label ${botActive ? 'live-bot-on' : ''}`}
                onClick={() => setBotPanelOpen(true)}
                title="Computer vs Students — bot plays on the shared board"
                aria-label="Computer vs Students"
              >
                <span aria-hidden="true">🤖</span>
                <span className="live-tool-label">Engine</span>
              </button>
            )}
            <button type="button" className="live-icobtn has-label" onClick={flip} title="Flip board" aria-label="Flip board"><span aria-hidden="true">⇅</span><span className="live-tool-label">Flip board</span></button>
            {permissions.canControlBoard && !drillActive && (
              /* Prev / Next / Brain are one control cluster: stepping through
                 the game, not three unrelated tools. */
              <div className="live-tool-group">
                <button type="button" className="live-movenav-btn has-label" onClick={viewPrev} disabled={!canViewPrev} title="Previous move"><span aria-hidden="true">◀</span><span className="live-tool-label">Prev</span></button>
                <button type="button" className="live-movenav-btn has-label" onClick={viewNext} disabled={!canViewNext} title="Next move"><span aria-hidden="true">▶</span><span className="live-tool-label">Next</span></button>
                <button
                  type="button"
                  className="live-movenav-btn live-movenav-btn-best has-label"
                  onClick={handleBestMove}
                  disabled={noLegalMoves || bestThinking}
                  title="Show Stockfish's suggested move as an arrow (nothing is played)"
                >
                  <span aria-hidden="true">{bestThinking ? '⏳' : '🧠'}</span>
                  <span className="live-tool-label">Brain</span>
                </button>
              </div>
            )}
          </div>
          {isInstructor && (
            <Button type="button" variant="secondary" size="sm" onClick={openInviteCard} title="Invite students to join this classroom">
              👥 Add students
            </Button>
          )}
          {/* Student access. The switch is what actually decides whether a
              student can touch a piece at all, so it is offered whether it is
              currently on or off — gating it on `studentInteractionEnabled`
              left the instructor with no way to turn it on from the room, and
              left the student reading "Viewing instructor demo" with nothing
              to tell them why. Only the side picker needs interaction to be on. */}
          {isInstructor && (
            <div className="live-tool-rows">
              <div className="live-tool-row">
                <span className="live-side-toggle-label">Students move:</span>
                <button
                  type="button"
                  className={`live-chip ${classMeta?.studentInteractionEnabled ? 'live-chip-on' : ''}`}
                  onClick={() => sendControl('toggle_interaction', { enabled: !classMeta?.studentInteractionEnabled })}
                  title={classMeta?.studentInteractionEnabled
                    ? 'Stop students moving the pieces'
                    : 'Let students move the pieces on this board'}
                >
                  {classMeta?.studentInteractionEnabled ? 'On' : 'Off'}
                </button>
              </div>
              {classMeta?.studentInteractionEnabled && (
                <div className="live-tool-row">
                  <span className="live-side-toggle-label">Which side:</span>
                  {['both', 'white', 'black'].map((side) => (
                    <button
                      type="button"
                      key={side}
                      className={`live-chip ${studentMoveSide === side ? 'live-chip-on' : ''}`}
                      onClick={() => sendControl('set_move_side', { side })}
                      title={`Students move ${side === 'both' ? 'either side' : side}`}
                    >
                      {side === 'both' ? 'Both' : side}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* 🤖 Computer vs Students — instructor fixes the match card: who plays,
          which side the bot takes from the CURRENT board position, strength, and
          then watch every chip in a puzzle-drill SAN strip (green = bot moves). */}
      {botPanelOpen && (
        <div className="live-bot-card-overlay" onClick={() => setBotPanelOpen(false)}>
          <div
            className="live-bot-card"
            role="dialog"
            aria-modal="true"
            aria-label="Computer vs Students match"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="live-bot-card-head">
              <span className="live-bot-card-title">🤖 Computer vs Students</span>
              <button type="button" className="live-bot-card-close" onClick={() => setBotPanelOpen(false)} aria-label="Close match card">✕</button>
            </div>

            <div className="live-bot-card-body">
              {/* select which students play */}
              <div className="live-bot-card-sec">
                <div className="live-bot-card-label">🎓 Pick the students</div>
                <div className="live-bot-card-student-list">
                  {participants && participants.length > 0 ? (
                    participants
                      .filter((p) => p?.roleInClass === 'student' && p?.status !== 'left')
                      .map((p) => {
                        const id = p?.userId;
                        const name = p?.displayName || p?.name || p?.email || 'Student';
                        const on = selectedBotStudents.includes(id);
                        return (
                          <label key={id} className={`live-bot-card-student ${on ? 'live-bot-card-student-on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setSelectedBotStudents((prev) =>
                                  on ? prev.filter((x) => x !== id) : [...prev, id]
                                )
                              }
                            />
                            <span className="live-bot-card-student-name">{name}</span>
                            <span className="live-bot-card-student-chip">♟</span>
                          </label>
                        );
                      })
                  ) : (
                    <div className="live-bot-card-empty">No students in the room yet.</div>
                  )}
                </div>
              </div>

              {/* match details — bot side + strength */}
              <div className="live-bot-card-sec">
                <div className="live-bot-card-label">Students play</div>
                <div className="live-bot-card-sides">
                  {['white', 'black'].map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`live-chip live-icobtn ${botSide === side ? 'live-chip-on' : ''}`}
                      onClick={() => setBotSide(side)}
                      title={`Students play ${side} — computer takes the other`}
                    >
                      {side === 'white' ? '⚪ White' : '⬛ Black'}
                    </button>
                  ))}
                </div>
                <div className="live-bot-card-label">Strength</div>
                <select
                  className="live-bot-card-strength"
                  value={botLevel}
                  onChange={(e) => setBotLevel(Number(e.target.value))}
                  title="Computer playing strength"
                >
                  {BOT_LEVELS.map((lvl) => (
                    <option key={lvl.level} value={lvl.level}>
                      Lv{lvl.level} · {lvl.label} ({lvl.ratingMax >= 9999 ? lvl.ratingMin + '+' : lvl.ratingMin + '-' + lvl.ratingMax})
                    </option>
                  ))}
                </select>
                <div className="live-bot-card-lock">
                  🔒 Start from the current board position (fixed)
                </div>
              </div>
            </div>

            <div className="live-bot-card-foot">
              <Button variant="primary" size="md" fullWidth
                type="button"
                disabled={!botSide || selectedBotStudents.length === 0}
                  onClick={async () => {
                    setBotCreating(true);
                    try {
                      await createClassroomBotGames({
                        classId: classMeta?.id,
                        studentIds: selectedBotStudents,
                        botColor: botSide === 'white' ? 'black' : 'white',
                        botLevel,
                        timeControl: { unlimited: true },
                        fen,
                        pgn: gameRef.current ? gameRef.current.pgn() : '',
                      });
                      /* Do NOT arm the shared-board bot here. Every selected
                         student already has their OWN bot game row, played on
                         their own PvP board and driven by their own client.
                         Arming the shared bot as well made the instructor's
                         client play a Stockfish move on the CLASS game ~900ms
                         later, so the computer's first move appeared on every
                         other student's (and the instructor's) shared board —
                         while the real game sat untouched on the student's
                         own board. */
                      setBotPanelOpen(false);
                      flash(`🤖 Bot (${botSide === 'white' ? 'black' : 'white'}, Lv${botLevel}) vs ${selectedBotStudents.length} student${selectedBotStudents.length === 1 ? '' : 's'} — pairing created!`);
                    } catch (err) {
                      flash(err?.response?.data?.message || err.message || 'Could not create the bot match.');
                    } finally {
                      setBotCreating(false);
                    }
                  }}
              >
                ⚔ Fix the pairing with bot
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 👥 Add students — instructor invites class members who aren't in the
          room yet; each gets a live "Join now" toast that opens /live-class/:id. */}
      {inviteOpen && (
        <div className="live-bot-card-overlay" onClick={() => setInviteOpen(false)}>
          <div
            className="live-bot-card"
            role="dialog"
            aria-modal="true"
            aria-label="Add students"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="live-bot-card-head">
              <span className="live-bot-card-title">👥 Add students</span>
              <button type="button" className="live-bot-card-close" onClick={() => setInviteOpen(false)} aria-label="Close add students card">✕</button>
            </div>

            <div className="live-bot-card-body">
              <div className="live-bot-card-sec">
                <div className="live-bot-card-label">🎓 Invite a student to join</div>
                {inviteLoading ? (
                  <div className="live-bot-card-empty">Loading students…</div>
                ) : inviteStudents.length === 0 ? (
                  <div className="live-bot-card-empty">No students left to invite — everyone you handle is already here.</div>
                ) : (
                  <div className="live-bot-card-student-list">
                    {inviteStudents.map((p) => {
                      const id = p?.userId;
                      const name = p?.name || p?.email || 'Student';
                      const on = selectedInviteStudents.includes(id);
                      return (
                        <label key={id} className={`live-bot-card-student ${on ? 'live-bot-card-student-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleInviteStudent(id)}
                          />
                          <span className="live-bot-card-student-name">{name}</span>
                          <span className="live-bot-card-student-chip">{p?.email ? '✉' : '♟'}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="live-bot-card-foot">
              <Button variant="primary" size="md" fullWidth
                type="button"
                disabled={inviteLoading || inviteSending || selectedInviteStudents.length === 0}
                onClick={sendInvites}
              >
                {inviteSending ? '⏳ Sending…' : `✉ Invite ${selectedInviteStudents.length || ''}`.trim()}
              </Button>
            </div>
          </div>
        </div>
      )}

    {posOpen && (
      <div className="live-bot-card-overlay" onClick={() => setPosOpen(false)}>
        <div
          className="live-bot-card live-pos-card"
          role="dialog"
          aria-modal="true"
          aria-label="Load a position"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="live-bot-card-head">
            <span className="live-bot-card-title">⎘ Load position</span>
            <button type="button" className="live-bot-card-close" onClick={() => setPosOpen(false)} aria-label="Close load position">✕</button>
          </div>

          <div className="live-bot-card-body">
            <div className="live-bot-card-sec">
              <div className="live-bot-card-label">Paste a FEN or PGN</div>
              <textarea
                className="live-pos-input"
                value={posText}
                onChange={(e) => { setPosText(e.target.value); if (posError) setPosError(''); }}
                placeholder={'FEN:  rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\nPGN:  1. e4 e5 2. Nf3 Nc6 3. Bb5 …'}
                spellCheck={false}
                autoFocus
              />
              <div className="live-pos-detect">
                {posKind
                  ? <>Detected: <strong>{posDetectedLabel}</strong></>
                  : 'Paste a position to load it on the shared board for everyone.'}
              </div>
              {posKind === 'pgn' && posGames.length > 1 && (
                <label className="live-pos-game">
                  <span className="live-pos-game-label">Game</span>
                  <select
                    className="live-bot-card-strength"
                    value={posGameIndex}
                    onChange={(e) => setPosGameIndex(Number(e.target.value))}
                  >
                    {posGames.map((g, i) => (
                      <option key={i} value={i}>{i + 1}. {pgnGameLabel(g, i)}</option>
                    ))}
                  </select>
                </label>
              )}
              {posError && <div className="live-pos-error" role="alert">{posError}</div>}
            </div>
          </div>

          <div className="live-bot-card-foot live-pos-foot">
            <Button variant="secondary" size="sm" type="button" onClick={copyCurrentFen} title="Copy the FEN currently on the shared board">Copy FEN</Button>
            <Button variant="secondary" size="sm" type="button" onClick={copyCurrentPgn} title="Copy the PGN currently on the shared board">Copy PGN</Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => { setPosText(''); setPosError(''); setPosGameIndex(0); }} disabled={!posText}>Clear</Button>
            <Button variant="primary" size="sm"
              type="button"
              onClick={handleLoadPosition}
              disabled={!posKind}
            >
              {posKind === 'fen' ? 'Load position' : 'Load game'}
            </Button>
          </div>
        </div>
      </div>
    )}

    {setupOpen && (
      <CustomizePositionModal
        initialFen={gameRef.current?.fen() || START_FEN}
        onApply={(fen) => {
          setSetupOpen(false);
          setViewIndex(null);
          sendControl('load_fen', { fen });
        }}
        onClose={() => setSetupOpen(false)}
      />
    )}
    </>
  );
}