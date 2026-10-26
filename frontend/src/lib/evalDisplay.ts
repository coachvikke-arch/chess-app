/* ── Evaluation-bar display helpers ──────────────────────────────────────────
 * Formatting and bar geometry ONLY. Nothing here feeds the engine, the CPL or
 * the classification pipeline: it reads the canonical white-perspective values
 * that already live in state and turns them into (a) the number shown under the
 * bar and (b) the White/Black split of the bar itself.
 *
 * Perspective: every argument is WHITE's point of view — centipawns for `cp`
 * (Stockfish's score, never pawns) and a signed distance for `mate`
 * (> 0 = White mates in `mate`, < 0 = Black mates), which is what
 * stockfish.js rankFieldsWhite() and engineScore.js already produce.
 *
 * Centipawns are converted to pawn units EXACTLY ONCE, here, at the moment of
 * display. Stored scores, CPL and classification keep reading the raw
 * centipawn values. */

/** Centipawns at which the bar saturates. This is the scale the GM replay
 *  curve has always used (GRAPH_SCALE_CP), so the bar, the curve and the
 *  review bar all move together: ±1 pawn ≈ 64/36, ±3.5 ≈ 88/12, ±5 ≈ 95/5. */
export const EVAL_BAR_SCALE_CP = 350;

/** Split used for a forced mate — decisive for the winning side, but never a
 *  flat 0%/100%, so the divider/marker stays visible on top of the fill. */
export const MATE_WHITE_PCT = 99;
export const MATE_BLACK_PCT = 1;

/** Sentinel engineScore.comparableScore() writes for a forced mate. */
const MATE_COMPARABLE_CP = 10000;

type EvalCp = number | null | undefined;
type EvalMate = number | null | undefined;

/** 1 = White mates, -1 = Black mates, null = no forced mate in this score.
 *  `mate === 0` (already mated) carries no side of its own, so the side falls
 *  back to the sign of the comparable centipawn value. */
function mateSide(mate: EvalMate, cp: EvalCp): 1 | -1 | null {
  if (mate != null && Number.isFinite(mate) && mate !== 0) return mate > 0 ? 1 : -1;
  if (cp != null && Number.isFinite(cp) && Math.abs(cp) >= MATE_COMPARABLE_CP) {
    return cp > 0 ? 1 : -1;
  }
  return null;
}

/** White's share of the evaluation bar, 0–100.
 *
 *  A bounded sigmoid — `50 + 50 * tanh(cp / EVAL_BAR_SCALE_CP)` — not a plain
 *  `50 + eval`: a +10 pawn score must approach, never exceed, the top of the
 *  bar. 0 cp is exactly 50/50, a forced mate parks the bar on the mating side,
 *  and an unknown evaluation reads as a level bar instead of a fake +0.0. */
export function evalBarPercent(cp: EvalCp, mate: EvalMate = null): number {
  const side = mateSide(mate, cp);
  if (side !== null) return side > 0 ? MATE_WHITE_PCT : MATE_BLACK_PCT;
  if (cp == null || !Number.isFinite(cp)) return 50;
  const pct = Math.round((50 + 50 * Math.tanh(cp / EVAL_BAR_SCALE_CP)) * 100) / 100;
  return Math.max(0, Math.min(100, pct));
}

/** The number under the bar: pawns to two decimals, signed, e.g. `-1.26`,
 *  `+0.75`, `0.00`. A forced mate keeps its mate information (`+M3`, `-M2`,
 *  or plain `+M`/`-M` when the distance is unknown) instead of being printed
 *  as an ordinary centipawn score. */
export function formatEvalScore(cp: EvalCp, mate: EvalMate = null): string {
  const side = mateSide(mate, cp);
  if (side !== null) {
    const distance = mate != null && Number.isFinite(mate) && mate !== 0 ? Math.abs(mate) : '';
    return `${side > 0 ? '+' : '-'}M${distance}`;
  }
  if (cp == null || !Number.isFinite(cp)) return '—';
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '-' : '';
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}

/** The number INSIDE the bar, where there is room for a couple of characters.
 *
 *  The bar is 30px wide, so the label is the compact form of the same value:
 *  one decimal (`+1.5`, `-0.8`, `0.0`) and the mate form without the extra
 *  plus (`M3`, `-M2` — the minus still carries the side).
 *
 *  It is a SEPARATE formatter on purpose: the caption under the bar keeps the
 *  precise two-decimal score, while the label inside the bar is the readable
 *  one. Both come from the same centipawn value, so they can never disagree. */
export function formatEvalLabel(cp: EvalCp, mate: EvalMate = null): string {
  const side = mateSide(mate, cp);
  if (side !== null) {
    const distance = mate != null && Number.isFinite(mate) && mate !== 0 ? Math.abs(mate) : '';
    return `${side < 0 ? '-' : ''}M${distance}`;
  }
  if (cp == null || !Number.isFinite(cp)) return '—';
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '-' : '';
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

/**
 * Where the score label goes inside the bar.
 *
 * The label rides on the White/Black split: it is parked on the line and hangs
 * on the side it describes, so a number is never read against the wrong fill.
 * Flipping the board flips which half is at the TOP, so "above the split" is
 * decided from the orientation, not from the colour.
 *
 * The split it rides on is clamped away from both ends of the bar by the
 * label's own height, so the label can never leave the bar - not even at ±M,
 * where the bar is otherwise almost entirely one colour.
 *
 * @param {object} args
 * @param {number|null} args.cp           the evaluation in centipawns (White's view)
 * @param {number|null} [args.mate]       a signed mate distance
 * @param {'white'|'black'} [args.orientation]  which way the board is turned
 * @param {number} [args.barHeightPx]     the bar's height, for the clamp
 */
export function evalLabelPlacement({
  cp,
  mate = null,
  orientation = 'white',
  barHeightPx = 360,
}: {
  cp?: EvalCp;
  mate?: EvalMate;
  orientation?: 'white' | 'black';
  barHeightPx?: number;
} = {}) {
  const whitePct = evalBarPercent(cp, mate);
  const barPct = orientation === 'black' ? 100 - whitePct : whitePct;
  /* Which half of the BAR is White's. */
  const whiteIsAbove = orientation === 'black';
  /* The label sits on the leader's side. */
  const onWhite = whitePct >= 50;
  const above = onWhite === whiteIsAbove;
  /* The label is ~18px tall: keep the split that far from both ends. */
  const padPct = Math.min(18, (18 / Math.max(1, barHeightPx)) * 100);
  const splitPct = Math.max(padPct, Math.min(100 - padPct, barPct));
  return {
    text: formatEvalLabel(cp, mate),
    onWhite,
    above,
    splitPct,
    whitePct,
    barPct,
  };
}
