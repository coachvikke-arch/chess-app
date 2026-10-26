/* ── MoveEffect maths ───────────────────────────────────────────────────────
 *
 * Pure functions only: no React, no DOM. Everything the renderer draws is
 * derived from a single time `t` (ms from dim start) through these helpers, so
 * the effect can be scrubbed, slowed down and unit tested without a browser.
 */

import { T, RIPPLE, WOBBLE, G } from './config.js';

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const lerp = (a, b, p) => a + (b - a) * p;
export const invLerp = (a, b, v) => (a === b ? 0 : clamp((v - a) / (b - a), 0, 1));

export const easeInOutCubic = (p) => (
  p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2
);
export const easeInCubic = (p) => p * p * p;
export const easeOutQuad = (p) => 1 - (1 - p) * (1 - p);
export const easeOutBack = (p, s = 1.7) => 1 + (s + 1) * ((p - 1) ** 3) + s * ((p - 1) ** 2);

/* ── ripple ───────────────────────────────────────────────────────────────── */

/** Ripple radius in squares, `seconds` after landing. */
export function rippleRadiusSq(seconds) {
  if (!(seconds > 0)) return 0;
  return RIPPLE.maxSq * (1 - Math.exp(-RIPPLE.k * seconds));
}

/**
 * Time (seconds after landing) at which the front reaches `distSq` squares
 * from the origin. Returns Infinity when the point is never reached.
 */
export function ripplePassSeconds(distSq) {
  if (!(distSq < RIPPLE.maxSq)) return Infinity;
  if (distSq <= 0) return 0;
  return -Math.log(1 - distSq / RIPPLE.maxSq) / RIPPLE.k;
}

/** Euclidean distance between two squares, in square units. */
export function squareDistance(a, b) {
  if (!a || !b) return Infinity;
  const file = a.charCodeAt(0) - b.charCodeAt(0);
  const rank = (Number(a[1]) || 0) - (Number(b[1]) || 0);
  return Math.hypot(file, rank);
}

/** 0 → 1 opacity envelope for the ripple visual (fades between r = 6 and 9). */
export function rippleOpacity(radiusSq) {
  return 1 - invLerp(RIPPLE.fadeFromSq, RIPPLE.fadeToSq, radiusSq);
}

/* ── piece wobble ─────────────────────────────────────────────────────────── */

/**
 * Wobble of a piece `tau` seconds after the front passed it.
 * `side` is +1/-1 depending on which side of the ripple origin the piece is.
 */
export function wobbleAt(tau, side, { strong = false } = {}) {
  if (!(tau >= 0)) return { rotate: 0, scale: 1 };
  const mul = strong ? WOBBLE.kingMultiplier : 1;
  const decay = Math.exp(-WOBBLE.decay * tau);
  const rotate = side * WOBBLE.deg * mul * decay * Math.sin(WOBBLE.freq * tau);
  const scale = 1 + WOBBLE.scale * mul * decay;
  return { rotate, scale };
}

/* ── flight ──────────────────────────────────────────────────────────────── */

/**
 * Where the moving piece is at time `t`, in SQUARE units (board display
 * coordinates, 0..8 on each axis) plus its scale.
 *
 * `from` / `to` are square centres in display units, e.g. a1 = { x: 0.5,
 * y: 7.5 } for a white-oriented board — compute them with squareCenter() and
 * divide by the square size so this stays resolution independent.
 */
export function flightAt(t, from, to, side = 1) {
  const hover = {
    x: to.x - side * G.hoverSideSq,
    y: to.y - G.hoverLiftSq,
  };

  if (t <= T.flyStart) return { x: from.x, y: from.y, scale: 1, phase: 'idle' };

  if (t < T.flyEnd) {
    const p = easeInOutCubic(invLerp(T.flyStart, T.flyEnd, t));
    return { x: lerp(from.x, hover.x, p), y: lerp(from.y, hover.y, p), scale: lerp(1, G.flyScale, p), phase: 'fly' };
  }

  if (t < T.hoverEnd) return { x: hover.x, y: hover.y, scale: G.flyScale, phase: 'hover' };

  if (t < T.dropEnd) {
    const p = easeInCubic(invLerp(T.hoverEnd, T.dropEnd, t));
    return { x: lerp(hover.x, to.x, p), y: lerp(hover.y, to.y, p), scale: lerp(G.flyScale, 1, p), phase: 'drop' };
  }

  return { x: to.x, y: to.y, scale: 1, phase: 'landed' };
}

/** Promotion pop: 1.3 → 1 over 220 ms after landing. */
export function morphScale(t) {
  const p = invLerp(T.landing, T.landing + 220, t);
  return lerp(1.3, 1, easeOutQuad(p));
}

/* ── badge / pill / sword ────────────────────────────────────────────────── */

/** Seal badge pop (scale 0 → 1, easeOutBack) over 250 ms from landing. */
export function badgeScale(t) {
  const p = invLerp(T.landing, T.landing + T.badgePopMs, t);
  return p <= 0 ? 0 : easeOutBack(p);
}

/** 0 → 1 pill width factor: grows 600-850, collapses 2850-3050. */
export function pillWidthFactor(t) {
  if (t < T.pillGrowStart) return 0;
  if (t < T.pillGrowEnd) return easeOutQuad(invLerp(T.pillGrowStart, T.pillGrowEnd, t));
  if (t < T.pillCollapseStart) return 1;
  if (t < T.pillCollapseEnd) return 1 - easeInCubic(invLerp(T.pillCollapseStart, T.pillCollapseEnd, t));
  return 0;
}

/** Label opacity: in with the pill, out 2600-2850. */
export function pillLabelOpacity(t) {
  if (t < T.pillGrowEnd) return 0;
  if (t < T.labelFadeStart) return 1;
  return 1 - invLerp(T.labelFadeStart, T.labelFadeEnd, t);
}

/** Soft glow pulse around 800 ms and again around 2900 ms. */
export function pillGlow(t) {
  const pulse = (centre, span) => Math.max(0, 1 - Math.abs(t - centre) / span);
  return Math.max(pulse(T.pillGrowEnd - 50, 160), pulse(T.pillCollapseStart + 50, 160));
}

/** Sword badge pop at 3130 (300 ms easeOutBack). */
export function swordScale(t) {
  const p = invLerp(T.swordStart, T.swordStart + T.swordMs, t);
  return p <= 0 ? 0 : easeOutBack(p);
}

/** Orange arrow grow 3250-3500. */
export function swordArrowScale(t) {
  return easeOutBack(invLerp(T.swordArrowStart, T.swordArrowEnd, t));
}

/* ── square path (which squares stay undimmed) ───────────────────────────── */

const FILES = 'abcdefgh';
const fileIndex = (sq) => FILES.indexOf(sq[0]);
const rankIndex = (sq) => Number(sq[1]) - 1;

/**
 * The squares the moving piece passes over: an L-path for a knight, the
 * straight line for a slider/king/pawn. `piece` is a chess.js type letter.
 */
export function pathSquares(from, to, piece, kingSquare) {
  if (!from || !to || from.length < 2 || to.length < 2) return [];
  if (piece === 'n') {
    const corner = to[0] + from[1];
    const out = [from];
    pushLine(out, from, corner);
    pushLine(out, corner, to);
    return unique(out);
  }
  /* Checkmate ripples from the mated king, but the undimmed path still belongs
     to the move, so `kingSquare` is only used to keep the API symmetrical. */
  void kingSquare;
  const out = [];
  pushLine(out, from, to);
  return unique(out);
}

function pushLine(out, from, to) {
  const fx = fileIndex(from);
  const fy = rankIndex(from);
  const tx = fileIndex(to);
  const ty = rankIndex(to);
  const steps = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
  for (let i = 0; i <= steps; i += 1) {
    const x = steps === 0 ? fx : Math.round(lerp(fx, tx, i / steps));
    const y = steps === 0 ? fy : Math.round(lerp(fy, ty, i / steps));
    out.push(FILES[x] + (y + 1));
  }
}

function unique(list) {
  return [...new Set(list)];
}

/** Board display centre of a square, in square units (0..8). */
export function squarePoint(square, orientation = 'white') {
  const f = fileIndex(square);
  const r = rankIndex(square);
  if (f < 0 || !(r >= 0 && r <= 7)) return null;
  const col = orientation === 'black' ? 7 - f : f;
  const row = orientation === 'black' ? r : 7 - r;
  return { x: col + 0.5, y: row + 0.5 };
}

/** Which side of the ripple origin a square is on: +1 right, -1 left. */
export function sideOf(square, originSquare, orientation = 'white') {
  const a = squarePoint(square, orientation);
  const b = squarePoint(originSquare, orientation);
  if (!a || !b) return 1;
  return a.x >= b.x ? 1 : -1;
}

/**
 * Clamp a box centred on (x, y) inside the board rectangle, in pixels.
 * Edge squares must shift their badge inward instead of being cut off by the
 * board clip; this is the single rule for every centred decoration.
 */
export function clampCentered(x, y, width, height, boardWidth) {
  const hw = width / 2;
  const hh = height / 2;
  return {
    x: clamp(x, hw, boardWidth - hw),
    y: clamp(y, hh, boardWidth - hh),
  };
}

/**
 * Place the label pill against a badge centre. It grows to the right while
 * there is room; on the h/g files (or any target close enough to the right
 * edge) it flips and grows left instead, staying inside the board either way.
 * The returned `origin` is the matching transform-origin.
 */
export function pillAnchor(x, y, width, height, boardWidth) {
  const growLeft = x + width > boardWidth;
  const top = clamp(y, height / 2, boardWidth - height / 2);
  const left = growLeft
    ? Math.max(0, x - width)
    : Math.min(x, boardWidth - width);
  return { left, top, growLeft, origin: growLeft ? 'right center' : 'left center' };
}
