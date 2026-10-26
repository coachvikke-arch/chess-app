import { useEffect, useId, useRef } from 'react';
import { squareCenter } from '../../utils/boardGeometry';
import { pieceGlyph } from '../CelebrationFX';
import { isQuietMoveEvent } from '../../utils/moveFeedback';

/* ── Promotion FX — the teal "Sigma-style" flourish on a pawn promoting ─────
 *
 * This is the PROMOTION animation (it is NOT the Brilliant/Sigma verdict card):
 * it plays for EVERY promotion — queen or underpromotion, by either side, from
 * a click/drag, a bot/socket reply, or a review ply. It borrows the app's teal
 * Sigma visual language (the same #19c9c3 halo the Brilliant badge uses) so a
 * promotion reads with the same energy as a brilliant move without ever
 * claiming to be one: there is no "Brilliant" label here, only the promoted
 * piece, so classification stays entirely the analysis pipeline's job.
 *
 * Every timing and colour knob lives in PROMOTION_FX below; nothing in the
 * render reads a magic number, so the whole feel can be retuned in one place.
 * All values are milliseconds unless noted.
 *
 * The sequence (t = 0 when the promotion is applied):
 *   0    – 240ms  teal trajectory arrow draws from the pawn's square to the
 *                 promotion square; source + destination squares light teal
 *   40   – 820ms  a turquoise aura blooms behind the new piece (white flash core)
 *   120 – 800ms  a soft teal shockwave ring expands across the board
 *   300 – 1250ms the badge pops in at the piece's top-right, then fades
 *   >1300ms      overlay unmounts, leaving the board's teal last-move tint
 *
 * The pawn-to-piece morph itself (pawn shrinks + flashes, chosen piece bounces
 * in) is owned by AnimatedBoard's `.ab-promo-old` / `.ab-promo-new` crossfade,
 * keyed to that board's own move duration — see index.css. This overlay only
 * adds the highlight / arrow / glow / badge around it.
 */
export const PROMOTION_FX = {
  /* Whole-overlay lifetime. Must outlast every animation below so the badge's
     fade-out finishes before the node is removed. */
  totalMs: 1300,
  reducedMs: 850,           // reduced motion: highlight + badge only

  /* trajectory arrow (the "move arrow" from the pawn's square to its target) */
  arrowDrawMs: 240,         // stroke draw-on
  arrowHoldMs: 820,         // how long the full arrow stays before fading
  arrowFadeMs: 240,         // fade-out
  arrowWidthRatio: 0.145,   // stroke width as a fraction of a square
  arrowShortenRatio: 0.46,  // stop this far (× square) short of the piece centre

  /* source / destination square highlight */
  highlightMs: 900,

  /* teal aura behind the promoted piece + white flash core */
  glowMs: 780,
  glowDelayMs: 40,
  glowSizeRatio: 1.85,      // aura diameter as a multiple of a square

  /* shockwave ring */
  ringStartMs: 120,
  ringMs: 680,

  /* badge */
  badgeDelayMs: 300,
  badgeMs: 950,

  /* capture flash / check+checkmate king pulse */
  captureFlashMs: 220,
  kingPulseDelayMs: 780,

  /* The app's Sigma (Brilliant) teal, reused so the promotion reads as part of
     the same visual language. */
  accent: {
    teal: '#19c9c3',
    tealDeep: '#0a807d',
    tealLight: '#bffbf6',
    glowRgb: '25, 201, 195',
  },

  captureColor: '255, 122, 69', // rgb triplet for the capture flash

  /* Optional extra cue; the move sound already plays the promotion cue, so this
     is off by default. Set to e.g. 'good' / 'celebrate' to add a flourish. */
  soundCue: null,
};

/* Badge copy: a queen promotion is the headline; any other piece is an
   underpromotion and names itself. This is NOT the Brilliant badge — it reads
   "PROMOTED", never "Brilliant". */
function badgeLabel(piece, color) {
  if (piece === 'q') return 'PROMOTED';
  return `${pieceGlyph(piece, color)} UNDERPROMOTION`;
}

/**
 * Promotion overlay.
 *
 * Purely visual: pointer-events:none, clipped to the board so nothing spills
 * over the page, sits above the pieces (the position is already updated), and
 * unmounts itself via `onDone` when the sequence ends. One absolutely-positioned
 * layer sized to the board, so it works at any size and in either orientation
 * (`squareCenter` mirrors for black).
 *
 * Props:
 *  - fx: { id, from, to, color, piece, isCapture, capturedSquare,
 *          isCheck, isCheckmate, kingSquare } — `id` must change per promotion
 *  - boardWidth, squarePx, orientation
 *  - inset: frame padding (px) so the layer aligns with the squares
 *  - reduced: prefers-reduced-motion — skip arrow/glow/ring, keep highlight+badge
 *  - onDone(id): called once when the sequence is over
 */
export default function PromotionFX({
  fx,
  boardWidth = 420,
  squarePx = 52.5,
  orientation = 'white',
  inset = 0,
  reduced = false,
  config = PROMOTION_FX,
  onDone,
}) {
  /* Keep the latest onDone without re-arming the cleanup timer every render. */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const arrowId = `pfx-arrow-${useId().replace(/[:]/g, '')}`;

  const lifetime = reduced ? config.reducedMs : config.totalMs;
  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current?.(fx.id), lifetime);
    return () => clearTimeout(t);
  }, [fx.id, lifetime]);

  if (!fx) return null;

  /* The badge is decoration; the animation is not. One shared flag decides it. */
  const quiet = isQuietMoveEvent('promotion');

  const { accent } = config;
  const from = squareCenter(fx.from, boardWidth, orientation);
  const to = squareCenter(fx.to, boardWidth, orientation)
    || { x: boardWidth / 2, y: boardWidth / 2 };

  /* Arrow geometry: from the centre of the pawn's square toward the promoted
     square's centre, shortened so the head stops just short of the new piece. */
  let arrow = null;
  if (from) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const drawn = Math.max(0, len - squarePx * config.arrowShortenRatio);
    arrow = {
      x1: from.x,
      y1: from.y,
      x2: from.x + ux * drawn,
      y2: from.y + uy * drawn,
      len: drawn,
      width: squarePx * config.arrowWidthRatio,
    };
  }

  /* Ring grows from the promoted square to the far corner of the board. */
  const base = boardWidth * 0.5;
  const maxDist = Math.max(
    Math.hypot(to.x, to.y),
    Math.hypot(boardWidth - to.x, to.y),
    Math.hypot(to.x, boardWidth - to.y),
    Math.hypot(boardWidth - to.x, boardWidth - to.y),
  );
  const ringScale = (maxDist / (base / 2)) * 1.02;

  const cap = fx.isCapture && fx.capturedSquare
    ? squareCenter(fx.capturedSquare, boardWidth, orientation)
    : null;
  const king = (fx.isCheck || fx.isCheckmate) && fx.kingSquare
    ? squareCenter(fx.kingSquare, boardWidth, orientation)
    : null;

  const sqLeft = to.x - squarePx / 2;
  const sqTop = to.y - squarePx / 2;

  return (
    <div
      className="pfx-layer"
      aria-hidden="true"
      style={{
        top: inset,
        left: inset,
        width: boardWidth,
        height: boardWidth,
        '--pfx-teal': accent.teal,
        '--pfx-teal-deep': accent.tealDeep,
        '--pfx-teal-light': accent.tealLight,
        '--pfx-glow-rgb': accent.glowRgb,
      }}
    >
      {/* Everything that must stay inside the board goes in the clipped layer;
          the badge is its sibling so it can overhang the edge. */}
      <div className="pfx-clip">
        {/* ── source + destination square highlight ── */}
        {from && (
          <span
            className="pfx-hl pfx-hl-from"
            style={{ left: from.x - squarePx / 2, top: from.y - squarePx / 2, width: squarePx, height: squarePx, '--pfx-hl-dur': `${config.highlightMs}ms` }}
          />
        )}
        <span
          className="pfx-hl pfx-hl-to"
          style={{ left: sqLeft, top: sqTop, width: squarePx, height: squarePx, '--pfx-hl-dur': `${config.highlightMs}ms` }}
        />

        {/* ── the trajectory arrow ── */}
        {arrow && !reduced && (
          <svg className="pfx-arrow" width={boardWidth} height={boardWidth} viewBox={`0 0 ${boardWidth} ${boardWidth}`}>
            <defs>
              <marker id={arrowId} markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto">
                <path d="M0,0 L3,1.5 L0,3 Z" fill={accent.tealLight} />
              </marker>
            </defs>
            <line
              x1={arrow.x1}
              y1={arrow.y1}
              x2={arrow.x2}
              y2={arrow.y2}
              stroke={accent.teal}
              strokeWidth={arrow.width}
              strokeLinecap="round"
              markerEnd={`url(#${arrowId})`}
              style={{
                '--pfx-len': arrow.len,
                '--pfx-draw': `${config.arrowDrawMs}ms`,
                '--pfx-hold': `${config.arrowHoldMs}ms`,
                '--pfx-arrow-fade': `${config.arrowFadeMs}ms`,
              }}
            />
          </svg>
        )}

        {/* ── capture: a quick red-orange flash on the captured square ── */}
        {cap && (
          <span
            className="pfx-tile pfx-capture"
            style={{
              left: cap.x - squarePx / 2,
              top: cap.y - squarePx / 2,
              width: squarePx,
              height: squarePx,
              '--pfx-rgb': config.captureColor,
              '--pfx-flash-dur': `${config.captureFlashMs}ms`,
            }}
          />
        )}

        {/* ── shockwave ring ── */}
        {!reduced && (
          <span
            className="pfx-ripple"
            style={{
              left: to.x,
              top: to.y,
              width: base,
              height: base,
              '--pfx-scale': ringScale,
              '--pfx-ripple-dur': `${config.ringMs}ms`,
              '--pfx-ripple-delay': `${config.ringStartMs}ms`,
            }}
          />
        )}

        {/* ── teal aura + white flash behind the promoted piece ── */}
        {!reduced && (
          <span
            className={`pfx-glow${fx.isCheckmate ? ' pfx-glow--mate' : ''}`}
            style={{
              left: to.x,
              top: to.y,
              width: squarePx * config.glowSizeRatio,
              height: squarePx * config.glowSizeRatio,
              '--pfx-glow-dur': `${config.glowMs}ms`,
              '--pfx-glow-delay': `${config.glowDelayMs}ms`,
            }}
          />
        )}

        {/* ── check/checkmate: pulse the king's square once ── */}
        {king && (
          <span
            className={`pfx-king ${fx.isCheckmate ? 'pfx-king--mate' : ''}`}
            style={{
              left: king.x - squarePx / 2,
              top: king.y - squarePx / 2,
              width: squarePx,
              height: squarePx,
              '--pfx-king-delay': `${config.kingPulseDelayMs}ms`,
            }}
          />
        )}
      </div>

      {/* ── the badge, popped at the top-right of the promoted piece ──
          The promotion is announced by its ANIMATION (the arrow, the ring, the
          teal glow and the king's pulse), so the badge itself is suppressed —
          the same shared flag that silences the brilliant and checkmate
          badges. */}
      {!quiet && (
        <span
          className="pfx-badge"
          style={{
            left: sqLeft + squarePx * 0.62,
            top: sqTop + squarePx * 0.02,
            '--pfx-sq': `${squarePx}px`,
            '--pfx-badge-dur': `${config.badgeMs}ms`,
            '--pfx-badge-delay': `${config.badgeDelayMs}ms`,
          }}
        >
          {badgeLabel(fx.piece, fx.color)}
        </span>
      )}
    </div>
  );
}
