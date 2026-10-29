import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChessBoard from './ChessBoard';
import EvalBar from './EvalBar';
import { Spinner } from './ui';
import { annotationForPly, getReplayStartFen, isCheckmatePosition, parsePgnReplay, type GmGame, type ReplayMove } from '../lib/chessReplay';
import { analyzeGmGame, cachedPositionLines, formatEval, lookupPositionLines, verdictLabel, type GmPlyAnalysis, type PositionLine } from '../lib/gmAnalysis';
import { buildMoveExplanation, formatPawnEval } from '../utils/chessMoveExplainer';
import { resolveInitialFen } from '../utils/canonicalAnalysis';
import { reviewMetaFor } from '../utils/gameReview';
import { EVAL_BAR_SCALE_CP } from '../lib/evalDisplay';
import { gmGames } from '../lib/dailyGames';
import { getGmGame } from '../services/gmGamesApi';
import useArrowKeys from '../hooks/useArrowKeys';
import { keepActiveMoveVisible } from '../utils/scrollActiveMove';

const AUTO_PLAY_MS = 1400;
const ANNOTATION_PAUSE_MS = 4800;

/* How long a piece takes to slide to its destination. ChessBoard is given this
   exact value below, and the classification badge waits the same length plus a
   few ms before appearing. They must stay tied together: when they were
   independent the badge popped first and read as if it marked the square the
   piece was leaving. */
const MOVE_ANIM_S = 0.25;
const MOVE_ANIM_MS = MOVE_ANIM_S * 1000 + 40;

/* Horizontal room the shared eval bar claims to the LEFT of the square, gap
   included. It lives inside `.gm-board-wrap` as a flex sibling of the board, so
   the panel has to be pinned this much wider than the board and the two-column
   layout has to give up the same amount — otherwise the bar either overflows the
   panel or pushes the square over the score sheet. Keep in sync with the 36px
   EvalBar track + the wrap's 8px `gap` in index.css. */
const EVAL_SLOT_PX = 44;

/* The evaluation curve. `preserveAspectRatio="none"` stretches this fixed
   viewBox to whatever width the moves panel has, so the geometry is resolution
   independent and the click-to-seek maths only has to undo the x scale. */
const GRAPH_W = 1000;
const GRAPH_H = 100;
const GRAPH_PAD = 4;

/* Centipawns at which the curve saturates — the eval bar's shared scale, so the
   curve and the bar always describe the same evaluation the same way. A ±9 pawn
   lead would otherwise flatten every real position into the same two pixels. */
const GRAPH_SCALE_CP = EVAL_BAR_SCALE_CP;

/* Board size multiplier, applied to every cap and floor below.
   0.96 = just 4% smaller than the original 520px/420px replay board. One knob
   so the desktop and compact (admin modal) boards stay in the same proportion
   to each other when this is tuned again. */
const BOARD_SCALE = 0.96;

type GameState = { status: 'idle' | 'loading' | 'ready' | 'missing'; game: GmGame | null };

/** One score-sheet row: the move number plus each side's move in that pair. */
type MoveRow = { number: number; white: ReplayMove | null; black: ReplayMove | null };

export default function GameReplay({ gameId, onGameLoad, compact = false }: { gameId: string; onGameLoad?: (game: GmGame) => void; compact?: boolean }) {
  const bundled = useMemo(() => gmGames.find((item) => item.id === gameId), [gameId]);
  const [fetched, setFetched] = useState<GameState>({ status: 'idle', game: null });

  useEffect(() => {
    if (bundled) {
      setFetched({ status: 'ready', game: bundled });
      return undefined;
    }
    let alive = true;
    setFetched({ status: 'loading', game: null });
    getGmGame(gameId)
      .then((res) => { if (alive) setFetched({ status: 'ready', game: res.data }); })
      .catch(() => { if (alive) setFetched({ status: 'missing', game: null }); });
    return () => { alive = false; };
  }, [gameId, bundled]);

  const game = fetched.game;
  /* Canonical initial-position precedence (PGN [FEN] → supplied → standard):
     a GM game that starts from a setup must replay AND analyse from its real
     origin, never silently from the standard position. */
  const startFen = useMemo(() => resolveInitialFen({ pgnText: game?.pgn }), [game]);
  const moves = useMemo(() => game ? parsePgnReplay(game.pgn, startFen) : [], [game, startFen]);

  /* Group the flat ply list into score-sheet rows (number + white + black).
     A 136-move game is 272 tokens, so a wrapping flex bag of them was unreadable
     — the move numbers never formed a column and the two sides drifted out of
     step. Pairing them into rows makes the grid columns line up exactly. */
  const moveRows = useMemo<MoveRow[]>(() => {
    const rows: MoveRow[] = [];
    for (const move of moves) {
      let row = rows[move.moveNumber - 1];
      if (!row) {
        row = { number: move.moveNumber, white: null, black: null };
        rows.push(row);
      }
      if (move.color === 'w') row.white = move;
      else row.black = move;
    }
    return rows;
  }, [moves]);

  const [ply, setPly] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  /* Which side the board is viewed from. Drives both the board and the player
     strips, so the two can never disagree about who is who. */
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  /* Phone layout stacks the panels under the board; one tab shows at a time.
     Desktop renders both cards side by side and ignores this. */
  const [mobilePanel, setMobilePanel] = useState<'moments' | 'score'>('moments');
  /* Engine verdicts, one entry per ply, filled in progressively as the whole
     game is searched. Kept as a plain array rather than a map so the score
     sheet can read `analysis[move.ply - 1]` directly. */
  const [analysis, setAnalysis] = useState<GmPlyAnalysis[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const boardPanelRef = useRef<HTMLDivElement>(null);
  const moveListRef = useRef<HTMLDivElement>(null);
  const activeTokenRef = useRef<HTMLButtonElement>(null);
  /* Pre-scale the initial width too, so the very first paint (before the
     measuring effect runs) is not a moment at the old, larger size. */
  const [boardWidth, setBoardWidth] = useState(340 * BOARD_SCALE);
  /* Set when the panel is so short that not even a legibility-sized board fits
     beside the chrome. The panel then scrolls instead of crushing the square to
     a few pixels — the controls stay in flow directly under the board and
     remain reachable. */
  const [cramped, setCramped] = useState(false);

  /* "Copied" confirmation for the PGN button, cleared on its own timer. */
  const [pgnCopied, setPgnCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const pgnCopyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pgnCopyTimer.current), []);
  /* A different game means the old "Copied" no longer refers to anything. */
  useEffect(() => { setPgnCopied('idle'); }, [game?.id]);

  /* Board sizing.
     The ref is only attached once the game has loaded, because the three
     early-returns below render a <Spinner> first. Keying the effect on
     `moves.length` re-runs it after the panel actually exists — without this
     the observer bails on mount (ref is null) and the board stays stuck at its
     300px initial state, never filling the column. */
  useEffect(() => {
    if (!moves.length) return undefined;
    const node = boardPanelRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      /* Measure the SHELL and the grid TRACK, and take the smaller. Measuring
         either one alone is circular here: the panel is pinned to
         `boardWidth + 8` (see the style below), and because a grid item's
         default `min-width` is `auto`, the track is then stretched by the
         panel's own width. Sizing the board from the track alone lets the board
         hold itself open — on a 360px phone the track reported 356px while the
         shell was only 338px, so the board overflowed sideways and pushed the
         right-hand control off-screen. The shell is laid out by the page and
         cannot be inflated this way, so it is the binding constraint on narrow
         screens, while the track is the binding one in the two-column desktop
         layout. Taking the min of the two is stable against both. */
      const shell = node.closest('.gm-replay-shell') || node;
      const rawTrack = node.parentElement || node;
      const contentWidth = (el) => {
        const s = window.getComputedStyle(el);
        return el.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
      };
      /* On the stacked mobile layout the grid is `display: contents` (it promotes
         the board panel and the moves panel to shell children so the engine card
         can be ordered between them). A `contents` box generates no box at all,
         so its clientWidth is 0 — measuring it would collapse the square to the
         floor. The shell is then the real track, so measure that instead. */
      const track = window.getComputedStyle(rawTrack).display === 'contents' ? shell : rawTrack;
      /* The board is the panel's widest child, so it may not exceed either box. */
      const available = Math.min(contentWidth(shell), contentWidth(track));

      /* Also keep the board inside its own grid COLUMN. The grid itself is
         `node.parentElement`, so `available` above is the WHOLE container, not
         the board's track — which lets a large board outgrow its column and
         paint over the score sheet. The real track width is the distance from
         the grid's left edge to the moves panel's left edge; in the stacked
         mobile layout that distance is zero, so it only binds when the board
         actually sits beside another column. The panel adds
         `boardWidth + 8 + EVAL_SLOT_PX` (its own inset padding plus the eval
         bar slot), so the square itself must stay that much short. */
      const gridEl = node.parentElement;
      const columnEnd = node.nextElementSibling;
      const colLimit = (() => {
        if (!gridEl || !columnEnd) return Infinity;
        /* Same `contents` case as `track` above: a box-less grid reports a
           zero-width rect at 0,0, so the subtraction would yield the moves
           panel's distance from the viewport origin — a huge, meaningless
           number that could stand in for the real column cap. With no grid box
           there is no column to stay inside, so this cap does not apply. */
        if (window.getComputedStyle(gridEl).display === 'contents') return Infinity;
        const col = columnEnd.getBoundingClientRect().left - gridEl.getBoundingClientRect().left;
        return col > 0 ? col - 8 - EVAL_SLOT_PX : Infinity;
      })();

      /* Also cap by height, so the whole replay (board + player strips +
         controls + progress) still fits on screen without scrolling. */
      const vh = window.innerHeight || 0;
      const chrome = compact ? 210 : 240; // strips, controls, progress, label
      const heightCap = Math.max(240, vh - chrome);

      /* The panel is pinned to `boardWidth + 8` (its horizontal padding) +
         `EVAL_SLOT_PX` (the bar and its gap), so the square may not claim the
         WHOLE available width — the bar sits beside it. The column cap below
         subtracts the same amount in the two-column layout; on the stacked
         mobile layout there is no column cap at all, so this is the subtraction
         that keeps the bar inside the screen instead of hanging off the edge. */
      let width = Math.floor(available) - 8 - EVAL_SLOT_PX;
      if (colLimit < width) width = colLimit;

      /* The viewport is NOT the real height budget inside the admin modal: that
         panel is a flex column inside a fixed-height dialog, so it can be far
         shorter than the window. Sizing the square from `vh` alone let it
         overflow its wrapper and paint straight over the control row — the
         buttons were still in the DOM (all 5), just buried behind the board.
         Measure the panel instead: the board wrapper is `flex: 1 1 auto` and
         every other child is `flex: 0 0 auto`, so whatever height is left after
         the chrome IS the room the square gets.

         This only ever SHRINKS, never grows. That matters: on the stacked
         mobile layout the panel is `display: block` with an auto height, so its
         content height just equals the current board — feeding that back as a
         cap would freeze the square at its initial size. When the wrapper
         already fits, the condition below is false and sizing stays
         width-driven, exactly as before. */
      const wrap = node.querySelector('.gm-board-wrap');
      let heightLimited = false;
      let sizeFloor = 0;
      /* When the admin modal scrolls, the square is NOT height-bounded: the
         modal grows (or scrolls) to fit, so the board sizes purely from width —
         only the fixed cap and the grid column decide how big it can get. The
         intricate "room" mathematics below is only for the height-pinned,
         non-scrolling dialog. */
      const gmModal = node.closest('.gm-admin-game-modal');
      const scrolls = (() => {
        if (!gmModal) return false;
        const ov = window.getComputedStyle(gmModal).overflowY;
        return ov === 'auto' || ov === 'scroll' || ov === 'visible';
      })();
      if (wrap) {
        /* Only the two-column admin panel is a flex column with a height fixed
           by its grid row, so only there does the square have a real height
           budget. The stacked mobile panel is `display: block` with an auto
           height — its content height IS the board, so capping against it would
           feed the current size back as its own limit and freeze the square. */
        const panelIsFlex = window.getComputedStyle(node).display === 'flex';
        /* Measure the gap the square actually has to live in, rather than
           adding up the heights of the other children. That arithmetic kept
           coming out a few pixels too generous — it ignored the wrapper's own
           vertical padding — and a square 3px too tall still overlapped the
           control row, which is exactly the bug this sizing exists to prevent.

           Two rendered edges bound the board: the top of the board wrapper and
           the top of the control row. Everything between them is the square's
           budget, minus the wrapper's padding, which is why that padding is
           subtracted. Both edges come straight from layout, so flex gaps and
           margins are accounted for automatically. */
        /* Crucially this `room` does not move when the square is resized: the
           wrapper is `flex: 1 1 auto`, so it always stretches to fill the space
           between those two fixed edges whether the board inside it is larger
           or smaller. That invariance is what makes the cap below stable. */
        const wrapEl = wrap as HTMLElement;
        const ctrls = node.querySelector('.gm-controls');
        const wrapBox = wrapEl.getBoundingClientRect();
        const wrapCS = window.getComputedStyle(wrapEl);
        const wrapPad = (parseFloat(wrapCS.paddingTop) || 0) + (parseFloat(wrapCS.paddingBottom) || 0);
        const floorEdge = ctrls
          ? ctrls.getBoundingClientRect().top
          : wrapBox.bottom;
        const room = Math.floor(floorEdge - wrapBox.top - wrapPad);

        /* Whether the panel is too short at all must be decided from a
           measurement that does NOT depend on the square. The `room` above is a
           rendered edge, and enabling the scroll fallback below changes where
           that edge lands — so using it to pick the mode made the two flip back
           and forth forever ("Maximum update depth exceeded").

           This second figure adds up the panel's fixed-height children, which
           are all nowrap or intrinsically sized, so it does not move when the
           board is resized. It is the stable signal for which mode to use. */
        const panelCS = window.getComputedStyle(node);
        const panelPad = (parseFloat(panelCS.paddingTop) || 0) + (parseFloat(panelCS.paddingBottom) || 0);
        let chromeH = panelPad;
        for (const child of node.children) {
          if (child === wrapEl) continue;
          chromeH += (child as HTMLElement).getBoundingClientRect().height;
        }
        const stableRoom = Math.floor(node.clientHeight - chromeH);

        if (panelIsFlex && room > 0 && !scrolls) {
          /* Too short for a square that reads as a board. Squeezing it into the
             leftover ~50px would technically dodge the overlap while producing
             a useless stamp, so keep the 120px floor and let the panel scroll
             instead. The controls stay in flow directly under the square and
             stay reachable — neither element hides the other. */
          const tooShort = stableRoom < 120;
          setCramped(tooShort);
          /* Only cap the width when there is room to honour. Above the floor the
             cap is applied EVERY time, not just when the board happens to
             overflow: testing for overflow first made this oscillate, since a
             square that fit fell back to the width-driven size, which overflowed
             the row, which shrank it again — the replay visibly pulsed. The
             wrapper is `flex: 1 1 auto`, so the room does not move when the
             square is resized, which makes the cap idempotent. */
          if (!tooShort) width = Math.min(width, room);
          heightLimited = true;
          /* The floor must never exceed the room itself, or the 120px square
             re-enters the loop it is meant to break: a narrow panel wraps the
             player strips onto extra lines, the chrome grows, the room shrinks,
             and the board overlaps the controls again. */
          sizeFloor = tooShort ? 120 : Math.min(120, room);
        }
      }

      /* The replay board must never be hand-capped below what the window allows —
   the "room" measurement already bounds it by the modal's real leftover height
   when the modal does not scroll, and a scrolling modal can ignore the
   viewport height entirely. */
      const cap = Math.min((compact ? 420 : 370) * BOARD_SCALE, scrolls ? Infinity : heightCap);

      const floor = (compact ? 210 : 240) * BOARD_SCALE;
      /* When height is the binding constraint the normal floor must yield,
         otherwise a short dialog keeps a 147px floor and the board still
         overlaps the controls. `sizeFloor` is the 120px legibility floor,
         already clamped to the available room by the block above. */
      setBoardWidth(Math.max(heightLimited ? sizeFloor : floor, Math.min(cap, width)));
    };
    update();
    const observer = new ResizeObserver(update);
    /* Watch the panel too, not just the shell. The panel is the flex column
       whose leftover height is the real budget, and in the admin modal it can
       change without the shell changing size. */
    const shell = node.closest('.gm-replay-shell') || node;
    observer.observe(shell);
    if (shell !== node) observer.observe(node);
    return () => observer.disconnect();
  }, [compact, moves.length]);

  useEffect(() => { setPly(0); setAutoPlay(false); setOrientation('white'); }, [gameId]);
  useEffect(() => { if (game) onGameLoad?.(game); }, [game, onGameLoad]);

  /* Grade the whole game through the canonical pipeline — the same reviewGame
     with the same engine config that Game Review and Chess Profile use, so a
     GM game classifies exactly the way it would on the Review page (a GM game
     is only different in source, never in classification). The run is aborted
     when the game changes or the panel unmounts (`alive`). */
  useEffect(() => {
    if (!moves.length) { setAnalysis([]); setAnalysisProgress(null); return undefined; }
    let alive = true;
    setAnalysis([]);
    setAnalysisProgress({ done: 0, total: moves.length });
    analyzeGmGame(startFen, moves.map((move) => move.san), {
      /* GM games are identified like every other game, so an analysis this game
         already has is reused rather than re-searched. */
      gameRef: { gameSource: 'gm', gameId: String(gameId) },
      onProgress: ({ done, total }) => { if (alive) setAnalysisProgress({ done, total }); },
      shouldAbort: () => !alive,
    }).then((result) => {
      if (!alive) return;
      setAnalysis(result);
      setAnalysisProgress(null);
    }).catch(() => {
      if (!alive) return;
      setAnalysisProgress(null);
    });
    return () => { alive = false; };
  }, [moves, startFen, gameId]);

  /* Evaluation curve. Index i is the position AFTER i plies, so index 0 is the
     starting position and the array is one longer than the move list — which
     means the current ply doubles as the current x position, with no off-by-one
     between the curve and the board. Positions the engine has not reached yet
     stay null and simply break the path into segments instead of being drawn
     as a false straight line through the origin. */
  const graphPoints = useMemo(() => [null, ...analysis.map((entry) => entry.evalAfter)], [analysis]);
  const graphPath = useMemo(() => {
    const count = graphPoints.length;
    if (count < 2) return '';
    const x = (i: number) => (i / (count - 1)) * GRAPH_W;
    const y = (cp: number) => GRAPH_H / 2 - Math.tanh(cp / GRAPH_SCALE_CP) * (GRAPH_H / 2 - GRAPH_PAD);
    let d = '';
    let penDown = false;
    graphPoints.forEach((cp, i) => {
      if (cp == null) { penDown = false; return; }
      d += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)} ${y(cp).toFixed(1)} `;
      penDown = true;
    });
    return d.trim();
  }, [graphPoints]);

  /* Keep the current move in view WITHIN the score sheet box. A long game
     scrolls well past the fold, so stepping (or auto-playing) past it would
     otherwise leave the reader staring at an unrelated part of the score
     sheet. The shared helper moves the score box's OWN scrollTop and nothing
     else: scrollIntoView() would scroll every scrollable ancestor, so on
     mobile's stacked layout it also dragged the whole page down to follow the
     moves while auto-play ran. Only the box's own scrollbar should move. */
  useEffect(() => {
    keepActiveMoveVisible(moveListRef.current, activeTokenRef.current);
  }, [ply, autoPlay]);

  const currentMove = moves[ply - 1] || null;
  const annotation = annotationForPly(game?.annotations.find((item) => {
    const firstPly = (item.moveNumber - 1) * 2 + 1;
    return ply === firstPly || ply === firstPly + 1;
  }), ply);

  /* ── Engine read-outs for the move currently on the board ──────────────────
     `analysis` is indexed by ply exactly like `moves`, so entry i describes the
     move that produced position i+1. */
  const currentAnalysis = ply > 0 ? analysis[ply - 1] || null : null;
  /* Vertical eval bar. White's share grows upward to match the curve, where a
     White advantage is drawn at the top. At ply 0 there is no verdict yet, so
     the bar sits level instead of implying a measured +0.0. The split is
     recomputed from the CURRENT position's evaluation on every render, so
     stepping through the game moves the fill and its divider with it. */
  const shownEval = currentAnalysis ? currentAnalysis.evalAfter : null;
  /* The engine's own choice, unless the game already played it. */
  const suggestion = currentAnalysis && !currentAnalysis.wasBest ? currentAnalysis : null;
  /* Squares to paint: the yellow last-move wash plus a green outline on the
     squares of the move the engine wanted instead. Merged rather than replaced,
     because the two regularly land on the same square and the move highlight
     has to survive. */
  const squareStyles = useMemo(() => {
    const styles: Record<string, { backgroundColor?: string; boxShadow?: string }> = {};
    const last = currentMove?.lastMove;
    if (last) {
      styles[last[0]] = { backgroundColor: 'rgba(250, 204, 21, .32)' };
      styles[last[1]] = { backgroundColor: 'rgba(250, 204, 21, .5)' };
    }
    const outline = 'inset 0 0 0 3px rgba(46, 204, 113, .9)';
    for (const square of [suggestion?.bestFrom, suggestion?.bestTo]) {
      if (!square) continue;
      styles[square] = { ...styles[square], boxShadow: outline };
    }
    return Object.keys(styles).length ? styles : undefined;
  }, [currentMove, suggestion]);

  /* ── Classification badge for the move on the board ──
     GameReview already badged its board this way; the replay showed the verdict
     only as a !/?!/?? suffix in the score sheet, so the position on the board
     carried no grade at all. ChessBoard wants the destination square plus
     0-indexed file/rank, and the verdict key is the canonical one straight off
     the analysis row — no local mapping. 'Good' and 'book' are deliberately
     excluded - a badge on every solid quiet move is noise (see MoveBadge).

     TIMING: the badge is held back until the piece has finished travelling.
     It is anchored to the destination square, but it used to pop in the same
     frame the move started, so on a quick step or an auto-play tick it looked
     like it was sitting on the pre-move square. Waiting for the animation makes
     "the piece is on x, and x is graded" a single readable event.

     MOVE_ANIM_S is the single source of truth for both the board animation and
     this delay - they were previously independent, which is how the badge came
     to lead the piece. */

  const [badgeLanded, setBadgeLanded] = useState(false);
  useEffect(() => {
    if (ply === 0) {
      setBadgeLanded(false);
      return undefined;
    }
    setBadgeLanded(false);
    /* A reduced-motion user gets no animation, so there is nothing to wait for
       and delaying would only make the badge feel broken. */
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBadgeLanded(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setBadgeLanded(true), MOVE_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [ply]);

  const moveBadge = useMemo(() => {
    if (!badgeLanded) return null;
    if (ply === 0 || !currentMove?.to) return null;
    const verdict = currentAnalysis?.verdict ?? null;
    if (!verdict || verdict === 'good' || verdict === 'book') return null;
    const to = currentMove.to;
    return {
      verdict,
      square: to,
      file: to.charCodeAt(0) - 97,
      rank: Number(to[1]) - 1,
    };
  }, [badgeLanded, ply, currentMove, currentAnalysis]);

  /* ── FEN of the position BEFORE the current move ────────────────────────
     Raw input for the explanation card: every derivation only makes sense
     against the position the mover actually faced. Ply 0/1 needs the game's
     REAL origin — the replay may start from a custom setup FEN, and the
     'start' sentinel is converted to a standard-start FEN here so the engine
     lookup is never handed a sentinel. */
  const fenBefore = useMemo(() => {
    if (!moves.length) return null;
    if (ply <= 1) return startFen === 'start' ? getReplayStartFen() : startFen;
    return moves[ply - 2].fen;
  }, [moves, ply, startFen]);

  /* ── On-demand PV lines for the explanation card ─────────────────────────
     Canonical rows keep each candidate's uci + eval but DROP its principal
     variation, so a PV can only be quoted when one is fetched for this exact
     position. lookupPositionLines caches by FEN (so navigating back to a move
     is instant and free) and shares one search between concurrent requests.
     Lines land in state tagged with the FEN they belong to, so a step happens
     before a search answers can never paste lines from another position onto
     the current card. */
  const [posLines, setPosLines] = useState<{ fen: string; lines: PositionLine[] | null } | null>(null);
  useEffect(() => {
    if (!currentAnalysis || !fenBefore) { setPosLines(null); return undefined; }
    const cached = cachedPositionLines(fenBefore);
    if (cached !== undefined) { setPosLines({ fen: fenBefore, lines: cached }); return undefined; }
    setPosLines(null);
    let alive = true;
    lookupPositionLines(fenBefore).then((res) => { if (alive) setPosLines({ fen: fenBefore, lines: res }); });
    return () => { alive = false; };
  }, [fenBefore, currentAnalysis]);

  /* ── The explanation card ──────────────────────────────────────────────────
     Built from facts only: the position before the move, the canonical row
     (verdict, mover-perspective cpl, engine lines) and — when the lookup has
     answered — the verified PVs. Prefer lookup lines (they carry PVs; the
     canonical ones deliberately do not), falling back to the canonical top-3
     while the one search runs or if it fails. */
  const explanation = useMemo(() => {
    if (!currentMove || !currentAnalysis || !fenBefore) return null;
    const validPos = posLines && posLines.fen === fenBefore ? posLines.lines : null;
    const source = validPos && validPos.length ? validPos : currentAnalysis.lines;
    return buildMoveExplanation({
      fen: fenBefore,
      side: currentMove.color,
      playedUci: currentAnalysis.uci || `${currentMove.from}${currentMove.to}`,
      playedSan: currentMove.san,
      moveNumber: currentMove.moveNumber,
      lossCp: currentAnalysis.cpl ?? null,
      lines: source.map((l) => ({
        uci: l.uci,
        score: l.score,
        mate: l.mate,
        pv: (l as PositionLine).pv ?? null,
      })),
    });
  }, [currentMove, currentAnalysis, posLines, fenBefore]);

  useEffect(() => {
    if (!autoPlay || !moves.length) return undefined;
    if (ply >= moves.length) { setAutoPlay(false); return undefined; }
    const timer = setTimeout(() => setPly((value) => value + 1), annotation ? ANNOTATION_PAUSE_MS : AUTO_PLAY_MS);
    return () => clearTimeout(timer);
  }, [autoPlay, ply, moves.length, annotation]);

  /* ← / → keyboard navigation, identical to the on-screen buttons.
     This MUST be called before the early returns below. It used to live in an
     IIFE buried in the JSX (~line 566), i.e. after those returns, so it only ran
     once the game had loaded. Loading -> loaded therefore went from 29 hooks to
     30 and React threw "Rendered more hooks than during the previous render",
     taking /admin/gm-games down with it. Hooks cannot be conditional; hoist it. */
  const stepBack = useCallback(() => {
    setAutoPlay(false);
    setPly((p) => Math.max(0, p - 1));
  }, []);
  const stepForward = useCallback(() => {
    setAutoPlay(false);
    setPly((p) => Math.min(moves.length, p + 1));
  }, [moves.length]);
  useArrowKeys(stepBack, stepForward);

  if (fetched.status === 'loading') return <Spinner text="Loading game…" />;
  if (!game) return <div className="gm-glass-card"><p className="gm-error">This featured game could not be found.</p></div>;
  if (!moves.length) return <Spinner text="Preparing the historical position…" />;

  /* Put the raw PGN on the clipboard, so the game can be loaded into Lichess,
     ChessBase or any editor without hunting for the source page. The Clipboard
     API needs a secure context, so a hidden textarea + execCommand covers
     plain http and file://, matching the copy helper in GameReview. */
  async function copyPgn() {
    if (!game?.pgn) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(game.pgn);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        try {
          ta.value = game.pgn;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
        } finally {
          /* Also on a throw — an orphaned textarea would sit invisible over the
             page and swallow clicks. */
          ta.remove();
        }
      }
    } catch {
      ok = false;
    }
    setPgnCopied(ok ? 'done' : 'failed');
    window.clearTimeout(pgnCopyTimer.current);
    pgnCopyTimer.current = window.setTimeout(() => setPgnCopied('idle'), 2000);
  }

  /* The strips name whoever's pieces are at the top and bottom of the board.
     React-chessboard's "white" orientation puts the White player's home rank
     (rank 1) at the BOTTOM, so in the default view BLACK is the top strip.
     Deriving both from one flag is what keeps the labels and the pieces in
     agreement — naming White on top inverted the board on every game. */
  const topIsWhite = orientation === 'black';
  const topPlayer = topIsWhite ? game.white : game.black;
  const topColor = topIsWhite ? 'white' : 'black';
  const bottomPlayer = topIsWhite ? game.black : game.white;
  const bottomColor = topIsWhite ? 'black' : 'white';
  /* The result ("1-0") is White's outcome, so it rides with White's strip. */
  const topMeta = topIsWhite ? game.result : `${game.event} · ${game.year}`;
  const bottomMeta = topIsWhite ? `${game.event} · ${game.year}` : game.result;
  const lastName = (n: string) => n.split(' ').pop() || n;

  return (
    <section className="gm-replay-shell gm-admin-replay-shell">

      <div className="gm-replay-grid">
        {/* The board is deliberately NOT in a card. It used to sit in one whose
            24px-radius surface and inner padding both fought the square: the
            padding made the board wider than the column (clipping its right
            edge) and the rounded corners showed dark wedges beside it. The
            player strips and controls stay — only the decorative card is gone. */}
        <div
          className={`gm-board-panel${cramped ? ' gm-board-panel--cramped' : ''}`}
          ref={boardPanelRef}
          /* Pin the panel to the board's own width so the strips, progress bar and
             position line sit flush with the square's edges. The grid column is
             much wider, and letting the panel fill it left that chrome
             overhanging the board once the square was scaled down. */
          style={{ width: boardWidth + 8 + EVAL_SLOT_PX }}
        >
          <div className="gm-player-strip" title={`${topPlayer} — ${topMeta}`}>
            <span className={`gm-player-dot gm-dot-${topColor}`} />
            <strong className="gm-strip-name">{topPlayer}</strong>
            {/* Explicit colour word, not just the dot: the strip swaps ends when the
              board is flipped, and a colour-blind reader cannot use the dot. */}
            <span className="gm-strip-color">{topColor === 'white' ? 'White' : 'Black'}</span>
            <span className="gm-strip-meta">{topMeta}</span>
            <button
              type="button"
              className="gm-flip"
              onClick={() => setOrientation((v) => (v === 'white' ? 'black' : 'white'))}
              title={`View from ${bottomPlayer}'s side`}
              aria-label={`Flip the board. Now viewing from ${bottomPlayer}'s side`}
            >
              ⇅ Flip
            </button>
          </div>
          <div className="gm-board-wrap">
            {/* Vertical evaluation, White's share on top. Rendered even before
                the first verdict lands so the slot is reserved and the board
                never shifts sideways when the analysis arrives. */}
            <EvalBar
              evaluation={shownEval}
              mate={currentAnalysis ? currentAnalysis.mateAfter : null}
              orientation={orientation}
              height={boardWidth}
            />
            <ChessBoard
              fen={ply === 0 ? startFen : currentMove.fen}
              lastMove={currentMove?.lastMove}
              orientation={orientation}
              interactive={false}
              boardWidth={boardWidth}
              frameless
              extraSquareStyles={squareStyles}
              moveBadge={moveBadge}
              animationDuration={MOVE_ANIM_S}
            />
          </div>
          {/* ← / → move navigation - matches the on-screen buttons exactly. */}
          <div className="gm-controls" aria-label="Replay controls">
            <button onClick={() => { setAutoPlay(false); setPly(0); }} aria-label="First move" title="First move (Home)">⏮</button>
            <button onClick={() => { setAutoPlay(false); setPly((p) => Math.max(0, p - 1)); }} aria-label="Previous move" title="Previous move (←)">◀</button>
            <button className="gm-play" onClick={() => setAutoPlay((v) => !v)} title={autoPlay ? 'Pause the replay' : 'Play the game automatically'}>{autoPlay ? '❚❚ Pause' : '▶ Auto-play'}</button>
            <button onClick={() => { setAutoPlay(false); setPly((p) => Math.min(moves.length, p + 1)); }} aria-label="Next move" title="Next move (→)">▶</button>
            <button onClick={() => { setAutoPlay(false); setPly(moves.length); }} aria-label="Last move" title="Last move (End)">⏭</button>
          </div>
          <div className="gm-progress"><span style={{ width: `${(ply / moves.length) * 100}%` }} /></div>
          <div className="gm-status-row">
            <span className="gm-position-label" title={ply === 0 ? 'Starting position' : `Move ${currentMove.moveNumber}${currentMove.color === 'w' ? '.' : '…'} · ${currentMove.san}`}>
              {ply === 0 ? 'Starting position' : `Move ${currentMove.moveNumber}${currentMove.color === 'w' ? '.' : '…'} · ${currentMove.san}`}
            </span>
            <span className="gm-move-counter">{ply}<span className="gm-move-total">/{moves.length}</span></span>
          </div>
          <div className="gm-player-strip" title={`${bottomPlayer} — ${bottomMeta}`}>
            <span className={`gm-player-dot gm-dot-${bottomColor}`} />
            <strong className="gm-strip-name">{bottomPlayer}</strong>
            <span className="gm-strip-color">{bottomColor === 'white' ? 'White' : 'Black'}</span>
            <span className="gm-strip-meta">{bottomMeta}</span>
          </div>
        </div>

        <div className="gm-mobile-tabs" role="tablist" aria-label="Game details">
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === 'moments'}
            onClick={() => setMobilePanel('moments')}
            className={`kt-tab shrink-0 ${mobilePanel === 'moments' ? 'active' : ''}`}
          >
            Key Moments
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === 'score'}
            onClick={() => setMobilePanel('score')}
            className={`kt-tab shrink-0 ${mobilePanel === 'score' ? 'active' : ''}`}
          >
            Score Sheet
          </button>
        </div>

        <aside className={`gm-moves-panel gm-glass-card${mobilePanel === 'moments' ? ' gm-mobile-hidden' : ''}`}>
          <div className="gm-panel-heading">
            <div className="gm-panel-heading-main">
              <span className="gm-eyebrow">Score sheet</span>
              <h2>
                <span className="is-white">{lastName(game.white)}</span>
                <span className="gm-panel-vs">vs</span>
                <span className="is-black">{lastName(game.black)}</span>
              </h2>
            </div>
            <div className="gm-panel-heading-side">
              <span className="gm-move-badge">{moveRows.length} {moveRows.length === 1 ? 'move' : 'moves'}</span>
              {game.pgn && (
                <button
                  type="button"
                  className={`gm-copy-pgn${pgnCopied === 'done' ? ' is-done' : ''}${pgnCopied === 'failed' ? ' is-failed' : ''}`}
                  onClick={copyPgn}
                  aria-live="polite"
                >
                  {pgnCopied === 'done' ? '✓ PGN copied' : pgnCopied === 'failed' ? 'Copy failed' : 'Copy PGN'}
                </button>
              )}
              {game.source && <a href={game.source} target="_blank" rel="noreferrer" className="gm-source">PGN source ↗</a>}
            </div>
          </div>

          {/* Evaluation curve for the whole game, filled in as the engine works
              through it. Tapping or clicking anywhere on it jumps the replay to
              that ply, so the shape of a game and any single position are one
              gesture apart. */}
          <div className="gm-eval-graph">
            <div className="gm-eval-graph-head">
              <span className="gm-eyebrow">Evaluation</span>
              {analysisProgress ? (
                <span className="gm-eval-graph-status">Analysing {analysisProgress.done}/{analysisProgress.total}</span>
              ) : analysis.length ? (
                <span className="gm-eval-graph-status">Engine review complete</span>
              ) : null}
            </div>
            <svg
              className="gm-eval-graph-svg"
              viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Evaluation over the course of the game"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                if (!box.width) return;
                const ratio = (event.clientX - box.left) / box.width;
                const last = graphPoints.length - 1;
                setAutoPlay(false);
                setPly(Math.max(0, Math.min(last, Math.round(ratio * last))));
              }}
            >
              <line className="gm-eval-graph-axis" x1="0" y1={GRAPH_H / 2} x2={GRAPH_W} y2={GRAPH_H / 2} />
              {graphPath && <path className="gm-eval-graph-line" d={graphPath} />}
              {shownEval != null && (
                <circle
                  className="gm-eval-graph-dot"
                  cx={(ply / Math.max(1, graphPoints.length - 1)) * GRAPH_W}
                  cy={GRAPH_H / 2 - Math.tanh(shownEval / GRAPH_SCALE_CP) * (GRAPH_H / 2 - GRAPH_PAD)}
                  r={GRAPH_W / 90}
                />
              )}
            </svg>
          </div>

          {/* The verdict on the move just played: how good it was, where the
              evaluation stands, and what the engine would have played instead. */}
          <div className="gm-eval-verdict">
            {ply === 0 ? (
              <span className="gm-eval-verdict-idle">
                {analysisProgress ? 'Analysing the game…' : 'The starting position'}
              </span>
            ) : currentAnalysis && currentAnalysis.verdict ? (
              <>
                <span className={`gm-eval-badge is-${currentAnalysis.verdict}`}>{verdictLabel(currentAnalysis.verdict)}</span>
                <span className="gm-eval-score">{formatEval(shownEval, currentAnalysis.mateAfter)}</span>
                {suggestion ? (
                  <span className="gm-eval-alt">
                    Engine preferred <strong>{suggestion.bestSan}</strong>
                  </span>
                ) : (
                  <span className="gm-eval-alt">The engine’s move</span>
                )}
              </>
            ) : (
              <span className="gm-eval-verdict-idle">
                {analysisProgress ? 'Analysing…' : 'No engine verdict for this position'}
              </span>
            )}
          </div>

          {/* A real score sheet: number | White | Black, one row per move pair.
              Fixed grid columns mean the numbers and both sides' SAN stay in
              vertical columns for the whole game, however long it runs. */}
          <div className="gm-score" ref={moveListRef} role="list" aria-label="Game moves">
            <div className="gm-score-head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader" className="is-white">{lastName(game.white)}</span>
              <span role="columnheader" className="is-black">{lastName(game.black)}</span>
            </div>
            {moveRows.map((row) => (
              <div className="gm-score-row" role="row" key={row.number}>
                <span className="gm-score-num" role="rowheader">{row.number}.</span>
                {(['white', 'black'] as const).map((side) => {
                  const move = row[side];
                  if (!move) {
                    /* A game can end after White's move (checkmate, resignation),
                        so the Black cell is rendered as a real empty cell to keep
                        the grid columns straight. */
                    return <span className="gm-score-cell is-empty" role="gridcell" key={side} />;
                  }
                  const isActive = move.ply === ply;
                  /* The suffix is the canonical verdict's own glyph, so the
                     score sheet and the verdict badge agree by construction. */
                  const verdict = analysis[move.ply - 1];
                  /* The suffix is the canonical verdict's own glyph, so the
                     score sheet and the verdict badge agree by construction. */
                  const notation = verdict?.verdict ? (reviewMetaFor(verdict.verdict)?.glyph ?? '') : '';
                  const grade = verdict?.verdict ? ` is-${verdict.verdict}` : '';
                  return (
                    <button
                      key={side}
                      type="button"
                      role="gridcell"
                      ref={isActive ? activeTokenRef : undefined}
                      className={`gm-score-cell${isActive ? ' is-active' : ''}${grade}`}
                      aria-current={isActive ? 'true' : undefined}
                      title={verdict?.bestSan && !verdict.wasBest ? `${verdictLabel(verdict.verdict)} — the engine preferred ${verdict.bestSan}` : (verdict ? verdictLabel(verdict.verdict) : undefined)}
                      onClick={() => { setAutoPlay(false); setPly(move.ply); }}
                    >
                      {move.san}{notation && <span className="gm-score-notation">{notation}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
      </div>
      <div className={`gm-commentary gm-glass-card${annotation ? ' annotated' : ''}${mobilePanel === 'score' ? ' gm-mobile-hidden' : ''}`}>
        <div className="gm-commentary-mark">{annotation ? '✦' : '◌'}</div>
        <div><span className="gm-eyebrow">{annotation ? 'Key moment' : 'Engine analysis'}</span><h3>{ply === 0 ? 'The opening setup' : `Move ${currentMove.moveNumber}${currentMove.color === 'w' ? '.' : '…'} ${currentMove.san}`}</h3>{ply === 0
          /* Nothing has been played yet, so there is no move to grade — the
             engine's verdict starts at move 1. */
          ? <p>Starting position. The engine reads each move as it is played, so its verdict begins with move 1.</p>
          : explanation ? (
          /* The explanation card: verdict badge plus mover-perspective eval
             before → after, then the verified "why", the plan, and the better
             alternatives. Every block degrades to a plain honest sentence
             when the engine has nothing verified to say — nothing is ever
             invented to fill a section. */
            <div className="gm-explain">
              <div className="gm-explain-head">
                <span className={`gm-eval-badge is-${currentAnalysis?.verdict}`}>{verdictLabel(currentAnalysis?.verdict)}</span>
                <span className="gm-explain-eval" title="Mover's evaluation before and after the move">
                  {formatPawnEval(currentAnalysis?.best, currentAnalysis?.bestMate) ?? '—'}
                  {' → '}
                  {formatPawnEval(currentAnalysis?.played, currentAnalysis?.playedMate) ?? '—'}
                </span>
              </div>
              <p className="gm-explain-why">{explanation.movePurpose.headline}</p>
              {explanation.movePurpose.details.length > 0 && (
                <ul className="gm-explain-facts">
                  {explanation.movePurpose.details.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
              {(explanation.strategicPlan.shortTerm || explanation.strategicPlan.longTerm || explanation.strategicPlan.contribution) && (
                <p className="gm-explain-plan">
                  {explanation.strategicPlan.shortTerm}
                  {explanation.strategicPlan.shortTerm && (explanation.strategicPlan.longTerm || explanation.strategicPlan.contribution) ? ' ' : ''}
                  {explanation.strategicPlan.longTerm}
                  {explanation.strategicPlan.longTerm && explanation.strategicPlan.contribution ? ' ' : ''}
                  {explanation.strategicPlan.contribution}
                </p>
              )}
              <div className="gm-explain-alternatives">
                <p className="gm-explain-alt-summary">{explanation.alternativeComparison.summary}</p>
                {explanation.alternativeComparison.alternatives.length > 0 && (
                  <ul className="gm-explain-alt-list">
                    {explanation.alternativeComparison.alternatives.map((alt) => (
                      <li key={alt.uci}>
                        <strong>{alt.san}</strong> {alt.aims}
                        {/* The first entry (when the played move differs from the
                            engine's choice) carries the verified comparison note;
                            every other entry falls back to the engine's own cost
                            label. Nothing shows when the engine does not say. */}
                        {alt.comparison
                          ? <span className="gm-explain-alt-note">{alt.comparison}</span>
                          : alt.costLabel ? <span className="gm-explain-alt-cost"> ({alt.costLabel})</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {explanation.principalVariation && (
                  <p className="gm-explain-pv">
                    Engine line: {explanation.principalVariation.sans.join(' ')}{explanation.principalVariation.truncated ? '…' : ''}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p>
              {isCheckmatePosition(currentMove.fen)
                ? 'Checkmate — the game ends here.'
                : analysisProgress || !currentAnalysis
                  ? 'The engine is still reading this position…'
                  : 'The engine had no score for this position.'}
            </p>
          )}
          {annotation?.comment ? <p className="gm-commentary-annotation">{annotation.comment}</p> : null}</div>
      </div>
    </section>
  );
}
