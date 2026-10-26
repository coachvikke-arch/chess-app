/* Which positions are worth a full-depth search?
 *
 * A game review used to give EVERY ply the same depth-18 MultiPV-3 search (plus a
 * second depth-18 search whenever the played move was not among the top 3). The
 * deep search is ~99% of the review's cost, so cutting review time means cutting
 * the NUMBER of deep searches, not their depth.
 *
 * The rule here is deliberately not "which moves are critical". It is the
 * question that actually matters for correctness:
 *
 *      could the cheap answer be wrong?
 *
 * A stage-1 CPL is trusted only when re-classifying it at cpl ± REVIEW_SAFE_BAND_CP
 * gives the SAME verdict three times. The margin stands in for how much the CPL
 * moves when the search deepens. Re-using the real classifier (rather than
 * comparing against a hand-written 50/100/200 checklist) is what makes this hold
 * at both ends of the range: near zero CPL the Nice/Ok/Strange boundaries sit at
 * single-digit centipawns, which a checklist centred on 50/100/200 would miss
 * entirely, and a blunder at 400cp is nowhere near any boundary.
 *
 * Everything here is a pure function of the game and a fixed margin, so the
 * same game always produces the same review — the determinism contract in
 * reviewConfig.js is preserved and no clock is consulted. */

import { MATE_SCORE_WINDOW, REVIEW_CRITICAL_CPL, REVIEW_CRITICAL_BAND_CP } from './reviewConfig.js';

/** True when a score is a mate score, whose distance is highly depth-sensitive. */
import { normalizeScore } from './engineScore.js';
export const isMateish = (input) => {
  const score = normalizeScore(input);
  return score?.type === 'mate' || (score?.type === 'cp' && Math.abs(score.value) >= MATE_SCORE_WINDOW - 1);
};

/**
 * Does this position need a full-depth search, or is the cheap scan enough?
 *
 * The cost of a review is (number of deep searches) x (cost of a deep search),
 * and a depth-10 scan is ~16-20x cheaper than the depth-18 search it stands in
 * for. So the question is purely: is the cheap number safe to publish?
 *
 * Three cases say no:
 *   - there is no cheap number at all;
 *   - a mate is involved, because mate distance is the least stable quantity in
 *     a search and every mate boundary is also a verdict boundary;
 *   - the centipawn loss is at or near REVIEW_CRITICAL_CPL, the blunder line.
 *
 * A single fixed CPL threshold is used deliberately. The obvious alternative —
 * re-classify the shallow CPL at +/- a margin and deep-search if the verdict
 * changes — was implemented and measured, and it is a performance trap: with a
 * 40cp margin the verdict flipped on nearly every ply, so ~90% of plies still
 * went deep AND the review paid a scan on top. That measured 186.0s against a
 * 46.9s baseline, i.e. four times SLOWER, and it still shifted classifications.
 * The reason is structural: the low-CPL boundaries (Nice/Ok/small inaccuracy) sit
 * only a few centipawns wide, so any margin wide enough to cover them also
 * swallows most of the CPL range. A threshold on centipawn loss is the only
 * version of this that is both fast and predictable.
 *
 * This is a pure function of the game and fixed constants, so the same game
 * always produces the same review — the determinism contract in reviewConfig.js
 * holds and no clock is consulted.
 *
 * @param {object} p
 * @param {number|null} p.cpl     centipawn loss from the cheap scan
 * @param {number|null} p.playedM played-move score, mover perspective
 * @param {number|null} p.bestM   best-move score, mover perspective
 * @param {number} [p.criticalCpl]    override REVIEW_CRITICAL_CPL
 * @param {number} [p.criticalBandCp] override REVIEW_CRITICAL_BAND_CP
 * @returns {{ deep: boolean, reason: string }}
 */
export function needsDeepReview({
  cpl,
  playedM,
  bestM,
  criticalCpl = REVIEW_CRITICAL_CPL,
  criticalBandCp = REVIEW_CRITICAL_BAND_CP,
}) {
  /* No usable cheap answer at all — nothing to trust, so search properly. */
  if (cpl == null || playedM == null || bestM == null) {
    return { deep: true, reason: 'missing-evaluation' };
  }

  /* Mate distances move around a lot between depths (mate in 3 at depth 10 can
     be mate in 5, or not found at all), and every mate boundary is a verdict
     boundary. Always confirm. */
  if (isMateish(playedM) || isMateish(bestM)) {
    return { deep: true, reason: 'mate-score' };
  }

  if (cpl >= criticalCpl) {
    return { deep: true, reason: 'critical-cpl' };
  }

  /* Just under the bar: a shallow search under-estimates centipawn loss, so
     this is the move most likely to turn out to be a blunder at full depth. */
  if (cpl >= criticalCpl - criticalBandCp) {
    return { deep: true, reason: 'near-critical' };
  }

  return { deep: false, reason: 'cheap' };
}
