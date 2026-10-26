import { useCallback, useEffect, useId, useMemo, useRef, useReducer, useState } from 'react';
import { Chess } from 'chess.js';
import AnimatedBoard from './board/AnimatedBoard';
import PromotionPicker from './board/PromotionPicker';
import { playSound, playMoveSound } from '../utils/sound';
import { useSound } from '../context/SoundContext';
import MoveEffect from '../effects/moveEffect/MoveEffect';
import {
  clearMoveEffects,
  getMoveEffectRun,
  subscribeMoveEffects,
  registerMoveEffectHost,
  markMoveEffectHostActive,
  notifyMoveEffectEnd,
  subscribeMoveEffectState,
  getVisibleEffectHost,
  clearVisibleEffectHost,
} from '../effects/moveEffect';
import { playEffectForMove } from '../effects/moveEffect/playForMove';

import MoveBadge from './MoveBadge';
import CelebrationFX from './CelebrationFX';

/* Accessible names for the engine's ranked candidate lines, shown as small
 * numbered chips on the board instead of the old "Best / Great / Good" words. */
const LINE_RANK_NAMES = ['Best line', 'Great line', 'Good line'];
import { getPieceTheme, buildCustomPieces } from '../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { useShowLegalMoves } from '../config/legalMoves';
import { useAllowPieceDrag } from '../config/pieceDrag';
import {
  marbledSquareStyle,
  ORNATE_NOTATION_STYLE,
  ROYAL_NOTATION_STYLE,
  framePalette,
} from '../config/ornateTheme';
import { useAuth } from '../context/AuthContext';
import { squareFromPoint, squareCenter } from '../utils/boardGeometry';
import { prefersReducedMotion } from '../config/boardAnimation';
import { useAutoQueen } from '../config/autoQueen';
import { sanitizeFen } from '../utils/fen';

/** Convert a #RGB / #RRGGBB hex color to an rgba() string with the given alpha. */
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(56,189,248,${alpha})`;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(56,189,248,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ── Check indicator ──────────────────────────────────────────────────────
 * The colour of a king that is in check. This is a FIXED yellow, not
 * `boardTheme.highlight`: the highlight token is a pale blue in nearly every
 * theme, so a king in check looked like the last-move marker rather than a
 * danger sign. A hazard indicator has to read the same on every board.
 *
 *   CHECK_YELLOW   — square of a king in check (pulsing)
 *   CHECKMATE_RED  — square of the mated king (steady; a stronger state)
 */
const CHECK_YELLOW = {
  fill: 'rgba(255, 214, 0, 0.62)',
  ring: 'inset 0 0 0 4px rgba(255, 214, 0, 1), 0 0 24px 6px rgba(255, 200, 0, 0.75)',
};

/* Mobile annotation gestures (touch only — mouse/pen behaviour is unchanged):
 *   - double-tap a square      → toggle a highlight
 *   - long-press then drag      → draw an arrow (the press ARMS the arrow tool)
 * LONG_PRESS_MS is how long a touch must rest before the arrow tool arms, and
 * LONG_PRESS_MOVE_TOLERANCE how far it may wander before the press is treated
 * as a drag instead. DOUBLE_TAP_MS is the window for the second tap. */
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const DOUBLE_TAP_MS = 300;
/* A single tap still clears all annotations (as it always has), but only after
   this delay — so a quick double-tap can win and toggle a highlight instead. */
const TAP_CLEAR_DELAY_MS = 260;
/* Sentinel `dragButton` value meaning "a long-press armed this arrow drag".
   Lets the overlay draw the live preview even though `arrowTool` is off. */
const DRAG_BUTTON_LONG_PRESS = 3;

/** Returns true if moving `piece` from `from` to `to` is a pawn promotion attempt. */
function isPromotion(game, from, to) {
  const piece = game.get(from);
  if (!piece || piece.type !== 'p') return false;
  const toRank = to[1];
  if (piece.color === 'w' && toRank !== '8') return false;
  if (piece.color === 'b' && toRank !== '1') return false;
  // confirm the move is legal (ignoring promotion piece)
  return game.moves({ square: from, verbose: true }).some((m) => m.to === to);
}

/* ── "Did exactly one move just happen?" ────────────────────────────────────
 * Used to sound moves that were applied to the game from OUTSIDE this board's
 * own drag handler (a bot reply, an opponent's move over a socket, a coach
 * driving the shared classroom board, stepping through a game in review).
 *
 * We answer it by asking the previous position for its legal moves and looking
 * for one that lands exactly on the new position. Working backwards from FENs is
 * what makes this safe for any caller: it can only ever match a real, legal move
 * of the position we were actually in, so we never invent a cue for a jump — a
 * new game load, a FEN paste, or several plies replayed at once all return null
 * and stay silent, exactly as chess.com does when you load a position rather than
 * watch someone play it.
 *
 * Comparison ignores the halfmove/fullmove counters, which advance on every ply
 * and would otherwise make an otherwise-identical position look different.
 */
function exactlyOnePly(prevFen, nextFen) {
  if (!prevFen || !nextFen || prevFen === nextFen) return null;
  let prevGame;
  try { prevGame = new Chess(prevFen); } catch { return null; }  // bad FEN from a caller
  const legal = prevGame.moves({ verbose: true });
  for (const m of legal) {
    try {
      prevGame.move(m.san);
      /* `isCheckmate`/`isStalemate` can end a game, but FEN stays comparable. */
      if (positionKey(prevGame.fen()) === positionKey(nextFen)) return m;
      prevGame.undo();
    } catch {
      /* Undo restores the position; keep scanning the remaining moves. */
    }
  }
  return null;
}

/** The part of a FEN that defines the position (ignores move counters). */
function positionKey(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

/**
 * Interactive chessboard.
 * - Pass `game` to use a controlled Chess instance owned by the parent (analysis).
 *   Otherwise `fen` seeds an internal game (puzzle mode stays self-contained).
 * - `onMove(move, game)` is called after a legal move.
 * - `onPositionChange()` fires when the position changes.
 */
export default function ChessBoard({
  game: gameProp,
  fen,
  /* Board role. 'game' (default) — any board used to play or view a game:
     live, vs computer, vs player, puzzle, review, analysis — is click-to-move
     ONLY; dragging is disabled. 'setup' — the piece-placer board — keeps
     dragging enabled and is otherwise unchanged. Legacy values ('analysis',
     'puzzle') are treated as game boards. */
  mode = 'game',
  onMove,
  onPositionChange,
  orientation = 'white',
  boardWidth = 420,
  interactive = true,
  showLegalMoves = false,
  draggableColor = null,   // restrict moves to this side's pieces (opponent side stays locked)
  clickToMove = false,     // force click-to-move affordances even on boards that hide move dots
  showNotation = true,
  /* Tri-state on purpose:
       true  → always sound, even if the user turned sound off globally
       false → never sound (used by setupMode and by true static previews)
       undefined (default) → follow the app-wide preference in SoundContext
     The old default was `false`, which is why only the handful of call sites
     that remembered `soundOn` made any noise at all. */
  soundOn,
  /* 'w'/'b' — whose moves get the "move-self" sample. null = fall back to
     `draggableColor`. Kept separate from `draggableColor` on purpose: the Play
     Arena wants the right sound for the bot's moves but must NOT have its drag
     rules silently changed, so it passes this instead. */
  selfColor = null,
  pieceTheme = 'auto',   // 'auto' → use saved pref; otherwise a PIECE_THEMES id
  boardThemeId = null,   // override the saved board theme (used by Settings previews)
  customArrows = [],
  lastMove,               // undefined → derive the last ply from `game`; null → no highlight
  highlightLastMove = true,
  engineOn = false,
  frameless = null,              // null → follow the saved frame preference; true/false → force
  animationDuration = 0.25,
  reviewVerdictColor = null,   // hex color tint for lastMove.to during review
  moveBadge = null,            // { square: 'e4', verdict: 'brilliant', ... } — overlay badge
  /* An EXPLICIT effect host id. A board normally identifies itself with a
     generated id, and a move effect that names no board goes to the board the
     user last touched. That is wrong when a board is opened OVER another one
     (the game-viewer card over the review board): the effect would be played
     on the board behind the card, and the card's own board would stay still.
     A parent that owns a board can pass a stable id here and name it in
     playEffectForMove({ boardId }). */
  moveEffectHostId: moveEffectHostIdProp = null,
  lineBadges = null,           // [{ to, rank }] engine top-lines, badged on the board (0 = best)
  fx = null,                   // { key, kind, square, kingSquare, piece, msg, xp, streak } — success FX
  setupMode = false,           // piece-placer: clicks place/remove the selected piece
  setupSelected = null,        // palette letter to place in setupMode
  onSetupSquare = null,        // called with the clicked square when setupMode is on
  positionOverride = null,     // raw position map (react-chessboard) to render instead of game.fen()
  extraSquareStyles = null,    // extra square styles merged over the defaults (annotations, etc.)
  allowNativeArrows = true,    // react-chessboard's own right-click-drag arrow tool
  onArrowsChange = null,       // fired with drawn native arrows [[from,to,color],...] so callers can broadcast
  arrowTool = false,           // OUR drag-to-draw arrows (pointer capture); native arrows disabled while on
  arrowPreviewColor = '#7dd3fc', // colour of the in-progress drag line; callers pass the same value they will commit so the preview does not flip colour on release
  onArrowDrawn = null,           // called (from, to) when the user finishes dragging an arrow (right-drag)
  onEraseArrow = null,           // called when a plain right-click happens (erase last arrow)
  onClearArrows = null,          // called when a plain LEFT-click happens (clear all arrows)
  onSquareRightClick = null,     // called with the square on a plain right-click (no drag)
  extraSquareClick = null,     // extra callback fired on every square click (alongside internal logic)
}) {
  const internalGameRef = useRef(null);
  /* Drop castling rights the position does not support BEFORE chess.js sees the
     FEN. `new Chess(fen)` accepts such a FEN, but its move generation then throws
     "Cannot mix BigInt and other types" (jhlywa/chess.js#577), which would crash
     any board whose caller passed a mid-game FEN still carrying default `KQkq`.
     Sanitizing here protects every page that renders a board. The same value is
     used by the sync effect below, so the sanitized position still compares equal
     to itself and cannot re-create the game on every render. */
  const safeFen = useMemo(
    () => (typeof fen === 'string' && fen ? sanitizeFen(fen) : fen),
    [fen],
  );
  if (!internalGameRef.current) {
    /* `new Chess(fen)` THROWS on a malformed FEN (chess.js v1 behaviour), and
     * this runs during render — so a single bad `fen` from any caller (a PGN
     * `[FEN]` tag, a database row, a truncated setup position) used to take the
     * whole page down before React could paint anything. Fall back to the
     * standard position instead of crashing; the sync effect below does the
     * same for later changes, and a caller that wants the real problem surfaced
     * can validate up front with isUsableFen(). */
    internalGameRef.current = (() => {
      if (!safeFen) return new Chess();
      try {
        return new Chess(safeFen);
      } catch (err) {
        console.warn('ChessBoard: ignoring invalid FEN, showing the start position.', fen, err);
        return new Chess();
      }
    })();
  }
  const [, force] = useReducer((x) => x + 1, 0);
  const controlled = Boolean(gameProp);
  const game = controlled ? gameProp : internalGameRef.current;

  /* App-wide "Show Legal Moves" master switch (Settings → Appearance). ANDed
     with each board's own `showLegalMoves` prop so a board that opts out stays
     out (static previews, non-interactive viewers), while switching the setting
     off hides the hints everywhere at once — the click-selected dots AND the
     in-flight drag dots. Only the two hint props below read this; move
     validation and click/drag-to-move are untouched. */
  const showLegalMovesGlobal = useShowLegalMoves();
  const legalHintsOn = showLegalMovesGlobal && (showLegalMoves || clickToMove);

  // Uncontrolled boards (reviews, replays, position viewers) still need to
  // follow an externally controlled FEN prop. Without this sync they keep the
  // position from their first render even when the parent changes moves.
  useEffect(() => {
    if (controlled || !safeFen || internalGameRef.current.fen() === safeFen) return;
    try {
      internalGameRef.current = new Chess(safeFen);
      force();
    } catch {
      // Preserve the last valid position if a caller supplies malformed FEN.
    }
  }, [safeFen, controlled]);
  const { boardTheme: savedThemeId, pieceSet, boardFrame } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId || savedThemeId);
  const ornate = Boolean(boardTheme.ornate);
  const royalOrnate = ornate && boardTheme.variant === 'royal';
  /* Frame visibility: the Settings toggle is the default, but a caller can still
     force it. `frameless` stays null when unspecified so "no prop" and "prop
     set to false" remain distinguishable — GameReview forces a bare board. */
  const showFrame = frameless === null ? boardFrame : !frameless;
  /* decorative frame band thickness (px) */
  const remC = showFrame ? Math.min(46, Math.max(20, Math.round(boardWidth * 0.082))) : 0;
  const framePad = showFrame ? 12 : 0;
  /* theme-tinted frame palette (marble, gold trim, labels, plinth) */
  const pal = framePalette(boardTheme);
  const themeStyles = getBoardThemeStyles(boardTheme);
  /* The overlay clips to the playing surface, rounded corners included. */
  const boardRadius = themeStyles.boardStyle?.borderRadius || '14px';

  const [selected,  setSelected]  = useState(null);

  /* Resolve the tri-state `soundOn` prop against the app-wide preference, so a
     board that says nothing gets the user's setting and a board that opts out
     is still honoured. Setup mode is a piece-placer, not a game, so it is
     always silent regardless. */
  const { soundOn: globalSoundOn } = useSound();
  const soundActive = soundOn === undefined ? globalSoundOn : soundOn;
  const soundEnabled = soundActive && !setupMode;

  /* draggableColor may arrive as 'white'/'black' (human) or 'w'/'b' (chess.js) */
  const draggableCode = draggableColor === 'white' ? 'w' : draggableColor === 'black' ? 'b' : draggableColor;

  /* ── Drag vs click-to-move ─────────────────────────────────────────────────
     Only the SETUP board may always drag pieces. Game boards are click-to-move
     by default but honour the app-wide "Drag Pieces" preference (Settings), so a
     user can re-enable dragging everywhere. `draggableCode` still enforces
     ownership/locks below, so a locked side can neither be selected nor moved. */
  const allowPieceDrag = useAllowPieceDrag();
  const allowDrag = mode === 'setup' || allowPieceDrag;
  const clickMoveEnabled = interactive;

  /* Same normalisation for selfColor, so `isSelf` compares chess.js codes ('w'/'b')
     rather than mixing a human 'white' against a move's 'w' — which would make
     every own move sound like the opponent's. */
  const selfColorCode = selfColor === 'white' ? 'w' : selfColor === 'black' ? 'b' : selfColor;

  /* Pending promotion: { from, to, color } — shown while picker is open */
  const [pendingPromo, setPendingPromo] = useState(null);

  /* ── MoveEffect (the "sigma move" overlay) ────────────────────────────────
   * The effect lives in one isolated module (effects/moveEffect) which owns
   * the timeline, visuals, sound, haptics and the EffectController state
   * machine. The board only decides WHEN to play it, hands over a config, and
   * hides the real pieces listed in the controller's `hiddenSquares` so the
   * overlay can fly and wobble its own copies.
   *
   * The overlay stays mounted after the timeline ends (badge/highlights and the
   * checkmate popup stay until the position changes) and is unmounted ONLY when
   * the controller reaches `idle` via cleanup(). Every run has a new runId, so
   * a stale timer or animation end can never clear a newer run.
   */
  /* The host id this board answers to. A parent may name the board (see the
     `moveEffectHostId` prop) so that a move effect can be addressed to THIS
     board and not to whichever board was touched last. */
  const generatedHostId = useId();
  const moveEffectHostId = moveEffectHostIdProp || generatedHostId;
  const [moveEffect, setMoveEffect] = useState(null);
  const [hiddenSquares, setHiddenSquares] = useState(null);
  const activeEffectRef = useRef(null);
  activeEffectRef.current = moveEffect;
  const reducedMotion = prefersReducedMotion();
  /* Auto-queen: when ON a pawn promoting is applied as a Queen immediately and
     the board popup picker is skipped. Read here (a hook) so the click/drop
     handlers below see the live value on every render. */
  const autoQueen = useAutoQueen();

  /* Build the payload the overlay needs. The position already includes the
     move, so the mover sits on `to`; the overlay excludes it from the ghost
     layer and draws it in flight instead. */
  const buildMoveEffect = useCallback((req) => {
    if (!req || !req.type) return null;

    /* Review navigation can request an effect BEFORE React has painted the new
       position into the board. Carry the resulting FEN with the request so the
       ghost layer is built from the position the move produced, never from the
       previous render's game object. */
    let effectGame = game;
    if (req.fen) {
      try { effectGame = new Chess(req.fen); } catch { effectGame = game; }
    }

    const pieceList = [];
    try {
      for (const row of effectGame.board()) {
        for (const cell of row) {
          if (cell && cell.square) {
            pieceList.push({ square: cell.square, code: `${cell.color}${cell.type.toUpperCase()}` });
          }
        }
      }
    } catch { /* a malformed position simply renders no ghosts */ }

    /* The captured piece is gone from the applied position, so recreate it for
       the overlay; it vanishes at T.captureGone (440 ms). */
    let captured = req.captured || null;
    if (!captured) {
      try {
        const hist = effectGame.history({ verbose: true });
        const last = hist[hist.length - 1];
        if (last && last.to === req.to && last.captured) {
          const enPassant = Boolean(last.flags && last.flags.includes('e'));
          captured = {
            square: enPassant ? last.to[0] + last.from[1] : last.to,
            code: `${last.color === 'w' ? 'b' : 'w'}${String(last.captured).toUpperCase()}`,
          };
        }
      } catch { /* ignore */ }
    }

    let kingSquare = req.kingSquare || null;
    if (!kingSquare && req.type === 'checkmate') {
      try {
        const turn = effectGame.turn();
        for (const row of effectGame.board()) {
          for (const cell of row) {
            if (cell && cell.type === 'k' && cell.color === turn) { kingSquare = cell.square; break; }
          }
          if (kingSquare) break;
        }
      } catch { /* ignore */ }
    }

    return {
      id: req.id,
      type: req.type,
      from: req.from,
      to: req.to,
      /* The position this effect belongs to. The board at most renders the
         effect while it shows this position; when the displayed move changes
         the effect is dropped immediately (see the guard effect below), so a
         leftover highlight can never sit on a later move. */
      fenKey: (() => {
        try { return positionKey(effectGame.fen()); } catch { return null; }
      })(),
      startFenKey: (() => {
        try { return positionKey(game.fen()); } catch { return null; }
      })(),
      piece: req.piece || 'p',
      color: req.color || 'w',
      promotionPiece: req.promotionPiece || null,
      sacrifice: Boolean(req.sacrifice),
      captured,
      kingSquare,
      pieces: pieceList,
      orientation: req.boardOrientation === 'black' ? 'black' : 'white',
    };
  }, [game]);

  const buildMoveEffectRef = useRef(buildMoveEffect);
  buildMoveEffectRef.current = buildMoveEffect;

  useEffect(() => {
    const unregister = registerMoveEffectHost(moveEffectHostId);
    const unsubscribe = subscribeMoveEffects((req) => {
      if (req === null) {
        /* cleanup() is the only reset. A cleared/unmounted overlay still counts
           as "settled": a card waiting on it must not stay hidden forever. */
        if (activeEffectRef.current) notifyMoveEffectEnd(activeEffectRef.current);
        setMoveEffect(null);
        setHiddenSquares(null);
        return;
      }
      if (req.targetHostId && req.targetHostId !== moveEffectHostId) return;
      const built = buildMoveEffectRef.current(req);
      if (!built) return;
      setMoveEffect(built);
    });
    return () => {
      /* Leaving the screen must stop every timer, sound and vibration. */
      if (activeEffectRef.current) notifyMoveEffectEnd(activeEffectRef.current);
      unregister();
      unsubscribe();
      /* A board that goes away must not stay the effect target: the next
         surface would address its effects to a board that no longer exists. */
      clearVisibleEffectHost(moveEffectHostId);
    };
  }, [moveEffectHostId]);

  /* Authoritative lifecycle: hidden pieces and the overlay are released ONLY
     when the controller says so. `finished` keeps the badge/highlights/popup,
     `idle` (cleanup) unmounts the overlay and restores the board exactly. */
  useEffect(() => {
    const unsubscribe = subscribeMoveEffectState(({ state, request, hiddenSquares: hidden }) => {
      const target = request?.targetHostId;
      const mine = !target || target === moveEffectHostId;
      if (state === 'idle' || !mine) {
        setHiddenSquares(null);
        if (state === 'idle') setMoveEffect(null);
        return;
      }
      setHiddenSquares(reducedMotion ? null : new Set(hidden || []));
    });
    return unsubscribe;
  }, [moveEffectHostId, reducedMotion]);

  /* The overlay is only a stand-in for the real pieces until the ripple has
     swept the board; the controller's settle timer is authoritative, but this
     lets the board take back over a frame earlier. */
  const handleEffectPhase = useCallback((phase) => {
    if (phase >= 2) setHiddenSquares(null);
  }, []);

  /* Is this board the one effects must play on?
   *
   * A surface can have two boards mounted at once (the Play Arena's page board
   * and its full-screen Play Mode board). The effect run is GLOBAL — one at a
   * time — so a board that is behind another one must NOT fire: it would
   * replace the run the visible board is playing, and the user would watch the
   * animation on the board they cannot see.
   *
   * With no visible host declared (a single-board surface) every board owns the
   * effect, exactly as before. */
  const ownsEffectTarget = useCallback(() => {
    const visible = getVisibleEffectHost();
    return !visible || visible === moveEffectHostId;
  }, [moveEffectHostId]);

  /* Clear the effect this board is responsible for. A run addressed to another
     board belongs to that board: a hidden Play Mode board must not wipe the
     visible board's effect just because a move arrived on it. */
  const clearOwnMoveEffects = useCallback((reason = 'move') => {
    const run = getMoveEffectRun();
    if (run && run.targetHostId && run.targetHostId !== moveEffectHostId) return;
    clearMoveEffects(reason);
  }, [moveEffectHostId]);

  /* Flipping the board changes what the effect's squares look like (and is an
     explicit navigation action), so it ends any effect that is still up. */
  const lastOrientationRef = useRef(orientation);
  useEffect(() => {
    if (lastOrientationRef.current === orientation) return;
    lastOrientationRef.current = orientation;
    clearOwnMoveEffects('orientation');
  }, [orientation, clearOwnMoveEffects]);

  /* ── the effect dies with its move ─────────────────────────────────────────
   * The overlay is already unmounted by the controller's hold timer, but this
   * is the immediate path: the moment the board shows a different position
   * than the one the effect belongs to, the effect is dropped. That makes a
   * stale highlight impossible even if a timer, animation end or re-render is
   * missed - the visible state is derived from the position, not from having
   * remembered to remove a class. */
  const seenEffectRef = useRef({ id: null, seen: false });
  useEffect(() => {
    if (!moveEffect) {
      seenEffectRef.current = { id: null, seen: false };
      return;
    }
    if (!moveEffect.fenKey) return;
    if (seenEffectRef.current.id !== moveEffect.id) {
      seenEffectRef.current = { id: moveEffect.id, seen: false };
    }
    let nowKey = null;
    try { nowKey = positionKey(game.fen()); } catch { return; }

    if (nowKey === moveEffect.fenKey) {
      seenEffectRef.current.seen = true;
      return;
    }
    /* Review/keyboard navigation starts the effect in the same tick as the
       position change; the board may not have painted the new position yet.
       Wait for it instead of killing the effect before it appears. */
    if (!seenEffectRef.current.seen && nowKey === moveEffect.startFenKey) return;

    const run = getMoveEffectRun();
    if (run && run.id === moveEffect.id) clearMoveEffects('position-changed');
    else {
      setMoveEffect(null);
      setHiddenSquares(null);
    }
  }, [game.fen(), moveEffect]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* Promotion / checkmate are known straight from the applied move. This is the
     live-move trigger; it goes through the SAME entry point as review
     navigation so live, bot, socket and keyboard effects share one lifecycle. */
  const triggerEventMoveEffect = useCallback((move, gameAfter) => {
    if (!move || !gameAfter) return false;
    /* Another board is on top: this one plays nothing. The caller must be told
       "not mine", not "nothing to play" — the difference is whether the visible
       board's effect is cleared. */
    if (!ownsEffectTarget()) return null;
    let ply = 1;
    try { ply = gameAfter.history().length || 1; } catch { /* FEN-only board */ }
    /* Hand the capture over explicitly: a board driven by `fen` re-creates its
       Chess instance, so its history cannot be relied on to find the victim. */
    const request = playEffectForMove(ply, 'live', {
      game: gameAfter,
      move,
      boardId: moveEffectHostId,
      orientation,
    });
    return Boolean(request);
  }, [moveEffectHostId, orientation, ownsEffectTarget]);

  /* ── Sounds for moves the user did NOT drag onto the board ────────────────
   * `applyMove` below fires the cue for moves the player makes on this board.
   * But plenty of boards move pieces without going through it: the bot replies
   * in the Play Arena, the live PvP/tournament boards receive an opponent's
   * move over the socket, the shared classroom board is driven by the coach,
   * and review boards step through a finished game. Those all mutate the same
   * Chess instance from outside, so they were completely silent — the exact
   * "chess.com plays a sound for the opponent's move too" behaviour that was
   * missing.
   *
   * We detect it by diffing the position history: if exactly one legal move
   * leads from the previous position to the current one, that move happened, so
   * replay it as a cue. `selfMoveRef` suppresses the case where the change was
   * OUR OWN move (already sounded in applyMove) and a bulk load/replay, where
   * many moves land at once and playing one cue per ply would be noise.
   *
   * The SAME diff drives the promotion FX, so a bot/engine/socket/replay
   * promotion ripples exactly like the player's own. That is why the history is
   * tracked unconditionally and only the SOUND is gated on `soundEnabled` —
   * previously the whole effect short-circuited when sound was off, which would
   * have silently disabled the FX too. */
  const positionHistoryRef = useRef([]);
  const selfMoveRef = useRef(false);

  useEffect(() => {
    const hist = positionHistoryRef.current;
    const currentFen = game.fen();

    /* No history yet → this is the first render. Record the starting position
       without reacting to it. */
    if (hist.length === 0) { hist.push(currentFen); return; }

    const prevFen = hist[hist.length - 1];
    if (prevFen === currentFen) return;

    /* We just made this move ourselves; applyMove already fired the cue/FX. */
    if (selfMoveRef.current) {
      selfMoveRef.current = false;
      hist.push(currentFen);
      if (hist.length > 3) hist.shift();
      return;
    }

    /* Exactly one move apart → a single real move; more than that means the
       parent loaded/replayed several plies at once, which we stay quiet for. */
    const onePly = exactlyOnePly(prevFen, currentFen);
    hist.push(currentFen);
    /* Keep the history short: we only ever compare against the last position. */
    if (hist.length > 3) hist.shift();

    /* A run already started FOR this position (review/keyboard navigation
       starts the effect before the board paints) is left alone. */
    const active = getMoveEffectRun();
    const activeMatches = Boolean(
      active && active.fen && positionKey(active.fen) === positionKey(currentFen)
    );

    /* Bulk load, new game, reset, FEN/PGN load, jump across several plies: the
       effect belonged to the old position and must not follow the board here. */
    if (!onePly) {
      if (!activeMatches) clearOwnMoveEffects('position-loaded');
      return;
    }

    if (activeMatches) return;

    /* Another board is on top (the Play Arena's full-screen Play Mode board):
       this board is behind it, so it plays NOTHING — not the effect, not the
       cue — and it must not clear the visible board's run either. */
    if (!ownsEffectTarget()) return;

    const fired = triggerEventMoveEffect(onePly, game);
    /* `null` means "not my board" (handled above); `false` means "this move
       carries no event", which clears the previous one. */
    if (fired === false) clearMoveEffects();

    if (!soundEnabled) return;
    const mine = selfColorCode || draggableColor;
    playMoveSound(onePly, {
      isSelf: !mine || onePly.color === mine,
      inCheck: game.inCheck(),
    });
  }, [game.fen(), soundEnabled, triggerEventMoveEffect, ownsEffectTarget]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── apply a fully-resolved move ── */
  function applyMove(source, target, promotion) {
    /* The previous move's effect is over the moment the next move starts. */
    clearOwnMoveEffects('before-move');
    try {
      const before    = game.get(target);
      const isCapture = before && before.color !== game.turn();
      const move = game.move({ from: source, to: target, promotion });
      if (!move) return false;

      if (soundEnabled) {
        /* `playMoveSound` owns the cue rules (castle / promotion / capture /
           self / opponent, then the check cue) so the external-move path below
           classifies identically. The en-passant flag 'e' is not a `captured`
           piece, so hand it over explicitly for the same reason the old inline
           chain did. */
        const mine = selfColorCode || draggableCode;
        playMoveSound(
          { ...move, captured: isCapture ? before : move.captured },
          {
            isSelf: !mine || move.color === mine,
            inCheck: game.inCheck(),
          }
        );
      }
      /* Mark it so the external-move watcher does not replay this move as a cue
         or an effect. Set even when sound is off, so a click-to-move promotion
         never plays twice. Cleared by the effect on its next run. */
      selfMoveRef.current = true;

      /* Promotion / checkmate on the player's own move; a quiet move clears the
         previous event's badge + highlights. A board that is NOT the visible one
         plays nothing and clears nothing. */
      const fired = triggerEventMoveEffect(move, game);
      if (fired === false) clearMoveEffects();

      /* Always re-render, even for a controlled `game`.
         With `!controlled` the board owns the game so it must repaint itself.
         With a controlled game we previously trusted the parent to re-render —
         but the CHECK GLOW is a safety-critical visual: if a parent does not
         repaint on `onPositionChange`, the king-in-check square keeps whatever
         it looked like before the move and the student never sees they gave
         check. `game` here is a shared Chess instance, so forcing a repaint
         only re-reads `game.fen()`; it cannot desynchronise the parent. */
      force();
      if (onPositionChange) onPositionChange();
      if (onMove) onMove(move, game);
      return true;
    } catch {
      if (soundEnabled) playSound('illegal');
      return false;
    }
  }

  /* ── handle a drop/click-move: intercept promotions ── */
  function doMove(source, target) {
    if (!interactive) return false;
    if (source === target) return false; // tapping a piece selects it — never a real move
    /* locked side: reject the drop so the piece snaps back untouched */
    const movingPiece = game.get(source);
    if (draggableCode && movingPiece && movingPiece.color !== draggableCode) return false;
    if (isPromotion(game, source, target)) {
      /* Auto-queen: skip the picker and promote immediately (same path as a
         picked move — validation, FX and sounds are unchanged). */
      if (autoQueen) return applyMove(source, target, 'q');
      /* otherwise show the picker instead of applying immediately */
      clearOwnMoveEffects('promotion-picker');
      setPendingPromo({ from: source, to: target, color: game.turn() });
      setSelected(null);
      return false; // don't let react-chessboard animate yet
    }
    return applyMove(source, target, 'q');
  }

  /* ── drop handler for DRAG moves ──
     Applies a legal move synchronously (doMove → applyMove → game.move) and
     reports the outcome so the board can animate correctly:
       true    → legal move applied (settle the piece on the target square)
       'promo' → legal promotion: the picker is opening and the move is NOT
                 applied yet, so the board must not animate the piece
       false   → illegal / locked drop (snap the piece back to its origin) */
  function attemptDrop(source, target) {
    if (!interactive || setupMode) return false;
    const movingPiece = game.get(source);
    if (draggableCode && movingPiece && movingPiece.color !== draggableCode) return false;
    if (isPromotion(game, source, target)) {
      /* Auto-queen: apply right away; the board settles the piece (true). */
      if (autoQueen) return doMove(source, target);
      setPendingPromo({ from: source, to: target, color: game.turn() });
      setSelected(null);
      return 'promo';
    }
    return doMove(source, target);
  }

  /* ── called when user picks a promotion piece ── */
  function handlePromoPick(piece) {
    if (!pendingPromo) return;
    const { from, to } = pendingPromo;
    setPendingPromo(null);
    applyMove(from, to, piece);
  }

  function cancelPromo() {
    setPendingPromo(null);
  }

  /* ── click-to-select legal moves ── */
  const targets = useMemo(() => {
    if (!selected) return [];
    const p = game.get(selected);
    if (!p || p.color !== game.turn()) return [];
    return game.moves({ square: selected, verbose: true });
  }, [selected, game, game.fen()]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelected(null);
  }, [game.fen(), showLegalMoves]);  // eslint-disable-line react-hooks/exhaustive-deps

  function handleSquareClick(sq) {
    if (extraSquareClick) extraSquareClick(sq);
    if (setupMode) {
      if (onSetupSquare) onSetupSquare(sq);
      return;
    }
    if (!clickMoveEnabled) return;
    if (pendingPromo) { cancelPromo(); return; }
    const piece = game.get(sq);
    if (!selected) {
      if (piece && piece.color === game.turn() && (!draggableCode || piece.color === draggableCode)) setSelected(sq);
      return;
    }
    if (sq === selected) { setSelected(null); return; }
    if (targets.some((m) => m.to === sq)) {
      doMove(selected, sq);
      setSelected(null);
      return;
    }
    if (piece && piece.color === game.turn()) {
      if (!draggableCode || piece.color === draggableCode) setSelected(sq);
      else setSelected(null);
    }
    else setSelected(null);
  }

  function handlePieceClick(_piece, sq) {
    if (setupMode) {
      if (onSetupSquare) onSetupSquare(sq);
    }
  }

  /* ── last move ─────────────────────────────────────────────────────────────
     The from/to highlight is derived from the move list, never from its own
     copied state, so it can never drift from the position on screen.
       - a caller that passes `lastMove` (explicit review scrub, or an explicit
         `null` for a fresh/start position) always wins;
       - a caller that passes nothing (most live / PvP / tournament / puzzle /
         academy boards only hand us the Chess instance) gets the last ply read
         straight off `game`. */
  const effectiveLastMove = useMemo(() => {
    if (lastMove !== undefined) return lastMove;
    try {
      const hist = game.history({ verbose: true });
      const last = hist[hist.length - 1];
      return last ? { from: last.from, to: last.to } : null;
    } catch {
      return null;
    }
  }, [lastMove, game, game.fen()]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── square highlight styles ── */
  const hgl = boardTheme.highlight;
  const hl = (alpha) => hexToRgba(hgl, alpha);

  /* ── ornate board: marble-tiled base background for every square. Highlights
     (set in squareStyles) only paint backgroundColor, so the marble veins stay
     visible beneath them. a1 is a dark square, so parity even → dark. ── */
  const ornateBase = useMemo(() => {
    if (!ornate) return null;
    const base = {};
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const isDark = (f + r) % 2 === 0;
        base['abcdefgh'[f] + (r + 1)] = marbledSquareStyle(
          isDark ? boardTheme.darkSq : boardTheme.lightSq,
          isDark,
          boardTheme
        );
      }
    }
    return base;
  }, [ornate, boardTheme]);
  const squareStyles = useMemo(() => {
    const styles = {};

    /* LAST MOVE — lowest layer: a semi-transparent amber wash on the square the
       piece came FROM and a deeper amber on the one it landed on (colours live
       in index.css as --last-move-from / --last-move-to). Because it is a
       background tint it sits under the pieces, and every stronger indicator
       below (selected / check) paints over it. Skipped entirely on the setup
       board. */
    if (highlightLastMove && !setupMode && effectiveLastMove) {
      /* Normal last-move wash only: the promotion's teal belongs to its effect
         and is gone with it, so a promotion leaves the same amber highlight as
         every other move. */
      if (effectiveLastMove.from) styles[effectiveLastMove.from] = { backgroundColor: 'var(--last-move-from)' };
      if (effectiveLastMove.to)   styles[effectiveLastMove.to]   = { backgroundColor: 'var(--last-move-to)' };
    }

    if (selected) {
      styles[selected] = {
        backgroundColor: hl(0.65),
        boxShadow: `inset 0 0 0 3px ${hl(0.9)}, 0 0 18px ${hl(0.45)}`,
      };
    }

    /* CHECK / CHECKMATE — read from the position on screen, never left behind
       by an effect:
         • a king in check pulses yellow;
         • a MATED king gets a small, STATIC marker (a dot + thin ring), not a
           glow, and it disappears as soon as an earlier move is displayed. */
    if (!setupMode && (game.inCheck() || game.isCheckmate())) {
      const mate = game.isCheckmate();
      const turn = game.turn();
      for (const row of game.board()) {
        for (const sq of row) {
          if (!sq || sq.type !== 'k' || sq.color !== turn || !sq.square) continue;
          styles[sq.square] = mate
            ? {
                backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(248,65,65,0.95) 0 7%, rgba(248,65,65,0.45) 8% 13%, transparent 14%)',
                boxShadow: 'inset 0 0 0 2px rgba(248,65,65,0.8)',
              }
            : {
                backgroundColor: CHECK_YELLOW.fill,
                boxShadow: CHECK_YELLOW.ring,
                animation: 'cb-check-glow 1.1s ease-in-out infinite',
              };
        }
      }
    }

    /* review verdict tint — the played move's squares glow in the colour of its
       classification (blunder/brilliant/…), overriding the neutral last-move
       highlight so board and move list share the same palette. */
    if (reviewVerdictColor && effectiveLastMove) {
      for (const sqKey of [effectiveLastMove.to, effectiveLastMove.from]) {
        if (!sqKey) continue;
        const ring = hexToRgba(reviewVerdictColor, 0.95);
        const fill = hexToRgba(reviewVerdictColor, sqKey === effectiveLastMove.to ? 0.42 : 0.24);
        styles[sqKey] = {
          backgroundColor: fill,
          boxShadow: `inset 0 0 0 2px ${ring}, 0 0 16px ${hexToRgba(reviewVerdictColor, 0.45)}`,
        };
      }
    }

    /* dim the board while promotion picker is open */
    if (pendingPromo) {
      styles[pendingPromo.from] = { backgroundColor: hl(0.3) };
      styles[pendingPromo.to]   = { backgroundColor: hl(0.5) };
    }

    /* extra annotation styles (arrows' highlights, instructor highlights, etc.) */
    if (extraSquareStyles) {
      for (const [sq, style] of Object.entries(extraSquareStyles)) {
        styles[sq] = { ...(styles[sq] || {}), ...style };
      }
    }

    return styles;
  }, [effectiveLastMove, highlightLastMove, selected, targets, pendingPromo, setupMode, boardTheme, hgl, hl, game.fen(), extraSquareStyles, reviewVerdictColor]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── arrows: react-chessboard wants [from, to, color?] tuples and silently
     drops everything else (it filters by arrow[0]/arrow[1]). Across the app we
     pass {from, to, color} objects, so normalise both forms before rendering. ── */
  const normalizedArrows = useMemo(() => {
    if (!Array.isArray(customArrows)) return [];
    return customArrows
      .filter((a) => {
        if (!a) return false;
        const from = Array.isArray(a) ? a[0] : a.from;
        const to = Array.isArray(a) ? a[1] : a.to;
        return from && to && from !== to;
      })
      .map((a) => (Array.isArray(a) ? a : [a.from, a.to, a.color].filter(Boolean)));
  }, [customArrows]);

  /* ── pieces from the user's board prefs; an explicit `pieceTheme` prop
     (e.g. AnalysisBoard's quick picker) overrides the saved preference.
     svg themes → undefined, so react-chessboard renders its built-in Cburnett
     images ── */
  const savedTheme = getPieceTheme(pieceSet || 'cburnett').id;
  const effectiveTheme = pieceTheme !== 'auto' ? getPieceTheme(pieceTheme).id : savedTheme;
  const customPieces = useMemo(() => buildCustomPieces(getPieceTheme(effectiveTheme)), [effectiveTheme]);

  /* ── annotation arrows: we ALSO render our own svg overlay so arrows drawn
     by the instructor are guaranteed visible on every client (some react-chessboard
     builds drop customArrows while pieces are animating). Square→px mapping is
     the shared `squareCenter` util (utils/boardGeometry), which honours
     orientation and is unit-tested. ── */
  const arrowUid = useId();

  /* ── our own drag-to-draw arrows ──
     react-chessboard's built-in arrow state wipes itself whenever customArrows
     changes, which breaks multi-arrow accumulation. So we draw arrows ourselves
     from raw pointer events and hand each finished (from,to) pair to the caller.
     Left-drag draws only while `arrowTool` is on; RIGHT-drag always draws (and a
     plain right-click toggles onSquareRightClick with that square). */
  const boardRef = useRef(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragTo, setDragTo] = useState(null);
  const [dragButton, setDragButton] = useState(null);
  /* Mobile annotation gesture state (touch only; mouse/pen unchanged).
     - long-press ARMS an arrow drag; releasing over another square commits the
       arrow, releasing on the same square cancels.
     - double-tap toggles a highlight.
     - a single tap still clears all annotations, but only after
       TAP_CLEAR_DELAY_MS so a double-tap can win first. */
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef(null);
  /* The pointer that owns the current touch gesture, so a second finger can
     cancel the annotation and let a pinch run. */
  const touchPointerRef = useRef(null);
  /* Last completed tap (double-tap detection) and its pending clear timer. */
  const lastTapRef = useRef({ square: null, at: 0 });
  const tapClearTimerRef = useRef(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const clearTapClearTimer = useCallback(() => {
    if (tapClearTimerRef.current) {
      clearTimeout(tapClearTimerRef.current);
      tapClearTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);
  useEffect(() => () => clearTapClearTimer(), [clearTapClearTimer]);

  const squareFromPointer = useCallback((e) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return squareFromPoint(e.clientX - rect.left, e.clientY - rect.top, rect.width, orientation, rect.height);
  }, [orientation]);

  const resetDragArrow = useCallback(() => {
    setDragFrom(null);
    setDragTo(null);
    setDragButton(null);
    touchPointerRef.current = null;
    clearLongPress();
  }, [clearLongPress]);

  const handleArrowPointerDown = useCallback(
    (e) => {
      const isLeft = e.button === 0;
      const isRight = e.button === 2;
      const allowedLeft = isLeft && (arrowTool || onClearArrows);
      const allowedRight = isRight && (onArrowDrawn || onEraseArrow || onSquareRightClick);
      if (!allowedLeft && !allowedRight) return;
      if (isRight) e.preventDefault();
      const isTouch = e.pointerType !== 'mouse';

      /* A second finger aborts the annotation so a pinch is free to run. */
      if (isTouch && touchPointerRef.current !== null && touchPointerRef.current !== e.pointerId) {
        clearTapClearTimer();
        resetDragArrow();
        return;
      }

      const sq = squareFromPointer(e);
      if (!sq) return;
      if (isRight) boardRef.current?.setPointerCapture?.(e.pointerId);
      if (isTouch) touchPointerRef.current = e.pointerId;
      setDragButton(isRight ? 2 : 0);
      setDragFrom(sq);
      setDragTo(sq);

      /* Touch press-and-hold ARMS the arrow tool (mobile has no right button).
         Wandering past the tolerance cancels it back into a plain tap/drag. */
      if (isLeft && isTouch && onArrowDrawn) {
        longPressFiredRef.current = false;
        longPressStartRef.current = { x: e.clientX, y: e.clientY };
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          longPressFiredRef.current = true;
          /* Light haptic tick so the instructor feels the arrow tool arm. */
          try { navigator.vibrate?.(10); } catch (_) {}
          setDragButton(DRAG_BUTTON_LONG_PRESS);
        }, LONG_PRESS_MS);
      }
    },
    [arrowTool, onClearArrows, onArrowDrawn, onEraseArrow, onSquareRightClick, squareFromPointer, clearTapClearTimer, resetDragArrow]
  );

  const handleArrowPointerMove = useCallback(
    (e) => {
      /* A held touch that wanders is a drag, not a long-press. */
      if (longPressStartRef.current) {
        const dx = e.clientX - longPressStartRef.current.x;
        const dy = e.clientY - longPressStartRef.current.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
      }
      if (!dragFrom) return;
      setDragTo(squareFromPointer(e));
    },
    [dragFrom, squareFromPointer, clearLongPress]
  );

  const handleArrowPointerUp = useCallback(
    (e) => {
      const isTouch = e.pointerType !== 'mouse';
      const longPressFired = longPressFiredRef.current;
      longPressFiredRef.current = false;
      const mods = e || {};
      clearLongPress();
      if (isTouch) touchPointerRef.current = null;

      if (dragFrom && dragTo) {
        if (dragTo === dragFrom) {
          if (dragButton === DRAG_BUTTON_LONG_PRESS) {
            /* long-press released on the start square — nothing to draw */
          } else if (longPressFired) {
            /* legacy press already ran a caller action — never clear the board */
          } else if (dragButton === 2) {
            /* plain right-click — fill the square via onSquareRightClick,
               passing the modifier keys that pick the colour (falls back to
               erasing the last arrow for legacy callers) */
            if (onSquareRightClick) {
              onSquareRightClick(dragFrom, {
                shiftKey: mods.shiftKey,
                ctrlKey: mods.ctrlKey,
                metaKey: mods.metaKey,
                altKey: mods.altKey,
              });
            } else onEraseArrow?.();
          } else if (isTouch) {
            /* Mobile tap. A second tap on the same square within the double-tap
               window toggles a highlight; otherwise the tap queues the old
               "clear all" action, delayed so the double-tap can win. */
            const now = Date.now();
            const last = lastTapRef.current;
            clearTapClearTimer();
            if (last.square === dragFrom && now - last.at <= DOUBLE_TAP_MS) {
              lastTapRef.current = { square: null, at: 0 };
              if (onSquareRightClick) onSquareRightClick(dragFrom, {});
            } else {
              lastTapRef.current = { square: dragFrom, at: now };
              if (onClearArrows) {
                tapClearTimerRef.current = setTimeout(() => {
                  tapClearTimerRef.current = null;
                  lastTapRef.current = { square: null, at: 0 };
                  onClearArrows();
                }, TAP_CLEAR_DELAY_MS);
              }
            }
          } else onClearArrows?.();
        } else if (dragButton === 2 || dragButton === DRAG_BUTTON_LONG_PRESS || arrowTool) {
          /* `'touch'` lets the caller toggle an existing arrow only for the
             mobile gesture, leaving mouse behaviour untouched. */
          onArrowDrawn?.(dragFrom, dragTo, isTouch ? 'touch' : undefined);
        }
      }
      resetDragArrow();
    },
    [dragFrom, dragTo, dragButton, arrowTool, onClearArrows, onArrowDrawn, onEraseArrow, onSquareRightClick, clearLongPress, clearTapClearTimer, resetDragArrow]
  );

  /* ── one square, in px (used by the FX + picker overlays) ── */
  const squareSize = boardWidth / 8;

  /* ── move-badge overlay position ──
     The badge must sit CENTERED on the TOP-RIGHT corner POINT of the
     destination square (straddling the boundary where 4 squares meet), not
     inside the square. We compute that corner's absolute pixel coordinates on
     the rendered board and anchor a zero-size point there; the dot inside is
     then centred on it via transform: translate(-50%, -50%).

     Square → screen mapping, honouring `orientation` (mirror columns for
     black's perspective, mirror rows so rank 1 is at the bottom when white):
       col = orientation === 'white' ? file : 7 - file
       row = orientation === 'white' ? 7 - rank : rank
     Square top-left pixel = (col * sq, row * sq).
     Top-right corner POINT = add one full square width (sq) on X. */
  const badgeSq = boardWidth / 8;
  const badgeCol = moveBadge ? (orientation === 'white' ? moveBadge.file : 7 - moveBadge.file) : 0;
  const badgeRow = moveBadge ? (orientation === 'white' ? 7 - moveBadge.rank : moveBadge.rank) : 0;
  /* corner x = square's left + one square width; corner y = square's top */
  const badgeX = badgeCol * badgeSq + badgeSq;
  const badgeY = badgeRow * badgeSq;
  /* badge diameter = 60% of one square (in px), so it spans ~half into the
     square and half over the adjacent squares, straddling the corner junction.
     Passed as a pixel value because the anchor container is a zero-size point
     (percentage sizing against it would collapse to 0). */
  const badgeDiameter = badgeSq * 0.6;

  /* ── Engine top-line badges ──
     Same corner-junction anchor as the move badge, so the rank sits on the
     destination square of each candidate line. Sized down (38% of a square)
     because three of them can land close together, and offset per rank so
     overlapping candidates stay individually readable. */
  const lineBadgeSq = boardWidth / 8;
  const lineBadgesOut = useMemo(() => {
    if (!Array.isArray(lineBadges)) return [];
    return lineBadges
      .map((b, i) => {
        const to = b && (b.to || (b.uci ? b.uci.slice(2, 4) : null));
        if (!to || to.length < 2) return null;
        const file = to.charCodeAt(0) - 97;
        const rank = Number(to[1]) - 1;
        if (file < 0 || file > 7 || !(rank >= 0 && rank <= 7)) return null;
        return {
          key: `${to}-${b.rank ?? i}`,
          rank: b.rank ?? i,
          /* Nudge each candidate a little further along the square edge so two
             lines ending on the same square do not stack into one blob. */
          nudge: i * lineBadgeSq * 0.13,
          left: (orientation === 'white' ? file : 7 - file) * lineBadgeSq + lineBadgeSq,
          top: (orientation === 'white' ? 7 - rank : rank) * lineBadgeSq,
        };
      })
      .filter(Boolean);
  }, [lineBadges, orientation, boardWidth]);

  /* draw one arrow line (+ its marker) in the overlay */
  const renderArrow = (from, to, color, markerId) => {
    const a = squareCenter(from, boardWidth, orientation);
    const b = squareCenter(to, boardWidth, orientation);
    if (!a || !b) return null;
    const dxl = b.x - a.x;
    const dyl = b.y - a.y;
    const r = Math.hypot(dyl, dxl);
    if (r < 1) return null;
    const reducer = boardWidth / 32;
    const end = { x: a.x + (dxl * (r - reducer)) / r, y: a.y + (dyl * (r - reducer)) / r };
    const c = color || arrowPreviewColor;
    return (
      <g key={`${from}-${to}-${markerId}`}>
        <marker id={markerId} markerWidth="2" markerHeight="2.5" refX="1.25" refY="1.25" orient="auto">
          <polygon points="0.3 0, 2 1.25, 0.3 2.5" fill={c} />
        </marker>
        <line
          x1={a.x} y1={a.y} x2={end.x} y2={end.y}
          opacity="0.9"
          stroke={c}
          strokeWidth={boardWidth / 40}
          strokeLinecap="round"
          markerEnd={`url(#${markerId})`}
        />
      </g>
    );
  };

  /* Only show a drag preview when that drag will actually commit an arrow —
     a right-drag, or a left-drag with the arrow tool on. A plain left-drag is
     how pieces are moved, so without this it painted a phantom arrow line
     across the board as the piece was dragged. */
  const dragPreviewing = dragFrom && dragTo && dragTo !== dragFrom && (dragButton === 2 || dragButton === DRAG_BUTTON_LONG_PRESS || arrowTool);
  const showOverlay = normalizedArrows.length > 0 || dragPreviewing;

  /* ── Themed frame: coordinate labels on the marble band, aligned to the real
   squares. Squares start `remC` (band) + 13 (frame border 1 + padding 12)
   from the outer edge; each label is centred on its square. ── */
  const remCoords = [];
  {
    const sq = boardWidth / 8;
    const origin = remC + 13;
    const sqC = (i) => origin + i * sq + sq / 2;
    const bandY = remC + 26 + boardWidth + remC * 0.5;
    const files = 'abcdefgh'.split('');
    for (let i = 0; i < 8; i++) {
      const f = orientation === 'white' ? i : 7 - i;
      remCoords.push(
        <span key={`rem-f${i}t`} className="rem-lab" style={{ left: sqC(i), top: remC * 0.5 }}>{files[f]}</span>,
        <span key={`rem-f${i}b`} className="rem-lab" style={{ left: sqC(i), top: bandY }}>{files[f]}</span>,
      );
    }
    for (let j = 0; j < 8; j++) {
      const r = orientation === 'white' ? 8 - j : 1 + j;
      const y = sqC(j);
      remCoords.push(
        <span key={`rem-r${j}l`} className="rem-lab" style={{ left: remC * 0.5, top: y }}>{r}</span>,
        <span key={`rem-r${j}rr`} className="rem-lab" style={{ left: remC + 26 + boardWidth + remC * 0.5, top: y }}>{r}</span>,
      );
    }
  }

  /* ── Themed frame: build once (clean marble band) ── */

  const frameClass =
    'chess-board-frame ' +
    (royalOrnate ? 'royal-ornate-frame' : 'themed-frame') +
    (engineOn ? ' engine-on' : '');

  const boardInner = (
    <>
        <div
          ref={boardRef}
          /* touch-action:none also for click-to-move game boards, so a tap on
             the board can never start a page pan/zoom (the arrow tools need it
             unconditionally). */
          style={(arrowTool || onArrowDrawn || onEraseArrow || onClearArrows || onSquareRightClick || clickMoveEnabled) ? { touchAction: 'none' } : undefined}
          onPointerDown={(e) => {
            /* Whichever board the student touches becomes the target for
               playMoveEffect() when no boardId is given (e.g. review panels). */
            markMoveEffectHostActive(moveEffectHostId);
            handleArrowPointerDown(e);
          }}
          onPointerMove={handleArrowPointerMove}
          onPointerUp={handleArrowPointerUp}
          onPointerLeave={resetDragArrow}
          onPointerCancel={resetDragArrow}
          onContextMenu={(e) => e.preventDefault()}
        >
          <AnimatedBoard
            position={positionOverride || game.fen()}
            onPieceDrop={(s, t) => attemptDrop(s, t)}
            onSquareClick={handleSquareClick}
            onPieceClick={handlePieceClick}
            getLegalTargets={interactive && legalHintsOn && !pendingPromo ? (sq) => {
              const p = game.get(sq);
              if (!p || p.color !== game.turn()) return [];
              return game.moves({ square: sq, verbose: true });
            } : undefined}
            /* Legal hints for the clicked piece are rendered INSIDE each square
               cell by AnimatedBoard (one centred dot per quiet move, a ring for a
               capture), so they can never drift into a row/column strip. */
            legalTargets={legalHintsOn && !pendingPromo ? targets : undefined}
            boardWidth={boardWidth}
            boardOrientation={orientation}
            /* Game boards are click-to-move only, so also stop taps from
               panning/zooming the page on touch devices. */
            lockTouch={clickMoveEnabled}
            /* Hand cursor on squares whose piece the side to move may pick up —
               only when dragging is off; with drag on the board shows a grab. */
            cursorForSquare={clickMoveEnabled && !allowDrag && !pendingPromo ? (sq) => {
              const p = game.get(sq);
              return Boolean(p && p.color === game.turn() && (!draggableCode || p.color === draggableCode));
            } : null}
            arePiecesDraggable={allowDrag && interactive && !pendingPromo && !setupMode}
            /* The prop was accepted and then dropped on the floor, so every board
             * animated at the same default no matter what a caller asked for —
             * which is why a game replay and a puzzle solve did not feel like the
             * same board. The value is still normalised here (0 → no animation)
             * and the shared Animation preference owns the actual timing. */
            animationDuration={Number.isFinite(animationDuration) ? Math.max(0, Math.min(animationDuration, 1)) : 0.25}
            customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
            customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
            customBoardStyle={
              themeStyles.boardStyle
                ? themeStyles.boardStyle
                : {
                    borderRadius: '14px',
                    overflow: 'hidden',
                    boxShadow: `${hexToRgba(pal.gold, 0.5)} 0 0 0 1px, ${hexToRgba(pal.gold, 0.16)} 0 0 24px, 0 14px 36px rgba(8,14,10,0.42)`,
                  }
            }
            customSquareStyles={ornateBase ? { ...ornateBase, ...squareStyles } : squareStyles}
            customPieces={customPieces}
            showBoardNotation={false}
            customNotationStyle={ornate ? (royalOrnate ? ROYAL_NOTATION_STYLE : ORNATE_NOTATION_STYLE) : undefined}
            customArrows={pendingPromo ? [] : normalizedArrows}
            insideNotation={!showFrame}
            /* The MoveEffect overlay draws its own copies of every piece so it
               can wobble them individually; the real ones step aside until the
               ripple has swept the board. Reduced motion draws no overlay
               pieces, so the board keeps its own. */
              hidePieces={hiddenSquares && !reducedMotion ? hiddenSquares : false}
          />
        </div>

        {/* ── annotation arrows (our own svg overlay — reliable on every board) ── */}
        {showOverlay && (
          <svg
            width={boardWidth}
            height={boardWidth}
            style={{ position: 'absolute', top: framePad, left: framePad, pointerEvents: 'none', zIndex: 12 }}
          >
            {normalizedArrows.map((arrow, i) => renderArrow(arrow[0], arrow[1], arrow[2], `${arrowUid}-h-${i}`))}
            {dragPreviewing && renderArrow(dragFrom, dragTo, arrowPreviewColor, `${arrowUid}-drag`)}
          </svg>
        )}

        {/* ── Move classification badge overlay ──
            Circular badge CENTERED on the top-right corner POINT of the
            destination square, straddling the junction of 4 squares. `left/top`
            mark that corner point; the dot is a zero-size anchor translated by
            translate(-50%,-50%) and scaled by --mb-size (60% of a square). */}
        {moveBadge && !pendingPromo && (
          <div
            className="move-badge"
            style={{
              left: badgeX,
              top: badgeY,
              ['--mb-size']: `${badgeDiameter}px`,
            }}
          >
            <MoveBadge verdict={moveBadge.verdict} />
          </div>
        )}

        {/* ── Engine top-line rank badges ──
            Replaces the old "Best / Great / Good" word legend that sat under the
            board. The words restated the arrow opacity that was already drawn on
            the board; a small 1/2/3 chip on each arrowhead carries the same
            ranking without pushing the move list down the page. */}
        {!pendingPromo && lineBadgesOut.map((b) => (
          <div
            key={b.key}
            className="line-badge-anchor"
            style={{
              left: b.left - b.nudge,
              top: b.top,
              ['--lb-size']: `${badgeSq * 0.38}px`,
            }}
            role="img"
            aria-label={LINE_RANK_NAMES[b.rank] || `Candidate ${b.rank + 1}`}
          >
            {b.rank + 1}
          </div>
        ))}

        {/* ── Duolingo-style success FX ── */}
        {fx && !pendingPromo && (
          <CelebrationFX fx={fx} squarePx={squareSize} orientation={orientation} />
        )}

        {/* ── MoveEffect: the "sigma move" overlay ──
            One master timeline (t = ms from dim start). It is mounted above the
            pieces and below the promotion picker, and it keeps the seal badge +
            highlights on screen after the animation finishes. */}
        {moveEffect && !pendingPromo && (
          <MoveEffect
            key={moveEffect.id}
            effect={moveEffect}
            boardWidth={boardWidth}
            orientation={moveEffect.orientation || orientation}
            inset={framePad}
            radius={boardRadius}
            pieces={customPieces}
            reduced={reducedMotion}
            onPhase={handleEffectPhase}
            onDone={() => notifyMoveEffectEnd(moveEffect)}
          />
        )}

        {/* ── Promotion picker (board popup) ──
            A single reusable overlay that dims the board and stacks the four
            pieces on the promotion square. It owns only its presentation; the
            move is still applied here via handlePromoPick. */}
        {pendingPromo && (
          <PromotionPicker
            key={`${pendingPromo.from}-${pendingPromo.to}`}
            color={pendingPromo.color}
            square={pendingPromo.to}
            orientation={orientation}
            boardWidth={boardWidth}
            inset={framePad}
            pieces={customPieces}
            reduced={reducedMotion}
            onSelect={handlePromoPick}
            onCancel={cancelPromo}
          />
        )}
    </>
  );

  if (!showFrame) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div style={{ position: 'relative' }}>{boardInner}</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div
        className="rem-outer"
        style={{
          ['--rem-c']: `${remC}px`,
          ['--rem-gold']: pal.gold,
          ['--rem-label']: pal.label,
          ['--rem-plinth-a']: pal.plinthA,
          ['--rem-plinth-b']: pal.plinthB,
        }}
      >
        {remCoords}
        <div className="rem-content">
          <div className={frameClass}>{boardInner}</div>
        </div>
      </div>
    </div>
  );
}
