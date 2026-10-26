/* Game accuracy engine — pure, deterministic, no engine / no I/O.
   Importable anywhere (browser review, node validation scripts).

   Model — chess.com-compatible, win%-drop based (see ./reviewConfig.js):
   - Per-move quality uses the win PERCENTAGE the move dropped:
        acc(i) = ACC_MAX · e^(−ACC_DECAY · winPctDrop) − ACC_FLOOR
     with winPctDrop = winPercent(best) − winPercent(played), floored at 0,
     and ACC_MAX/ACC_DECAY/ACC_FLOOR the reverse-engineered chess.com CAPS
     constants (103.1668 / 0.04354 / 3.1669), clamped to 0..100. Perfect
     verdicts (Best/Brilliant/Great) have a 0 drop → 100 exactly.
- Game accuracy: the PLAIN MEAN of those per-move grades (exactly chess.com's
   CAPS headline — no volatility re-weighting). Every analysable move counts a
   weight of 1, so a blunder pulls the headline down by its own per-move score:
   many blunders ⇒ the headline falls well below 90%, one clean move's blunder
   dents it proportionally to its share of the game.
        game_acc = Σ(acc_i) / n
   Book moves are the engine's theory and score the full 100, exactly like
   chess.com's "Book moves are always scored as best", with weight 1. Rows
   without engine data drop out (null) so the number is never invented.
*/

import { moveMetrics, winPercent, winPct, winPercentDrop, round1 } from './reviewClassify.js';
import { ACCURACY_DECAY, ACCURACY_CPL_CAP, ACC_MAX, ACC_DECAY, ACC_FLOOR } from './reviewConfig.js';
import { getDisplayVerdict } from './sigmaType.js';

/* 100 · e^(−0.004 · avgCpl) — the classic exponential fallback, kept
   exported for compatibility (the aggregator now prefers accuracy=null over
   inventing a number when there is nothing to weigh). NOT used by reviews. */
export function accuracyFromCpl(avgCpl) {
  if (avgCpl == null || avgCpl <= 0.001) return 100;
  const x = Math.max(0, Math.min(100, 100 * Math.exp(-ACCURACY_DECAY * avgCpl)));
  return round1(x);
}

/* Aggregate one player's rows into a per-side summary.
   `moves` are the review rows (each with player/verdict/cpl/wpd/loss/best/
   played); `countsInit` is a pre-zeroed { verdict: 0 } map (REVIEW_ORDER).
   Book moves and rows without engine data (`loss` null) drop out of the score.

   When there is no analysable data (`movesPlayed` ≈ 0) the accuracy is
   null — NOT the misleading 100% of the old no-data fallback — so the UI
   can say "no data" instead of "perfect game". avgCpl and avgWpd are null
   too; `total` (all this player's rows, including book) enables coverage
   display. */
export function aggregateSide(moves, player, countsInit) {
  const counts = { ...countsInit };
  let total = 0, book = 0, cplSum = 0, cplN = 0, wpdSum = 0, wpdN = 0;
  const scored = []; // { acc, v } for the per-move headline
  for (const m of moves) {
    if (m.player !== player) continue;
    total += 1;
    /* Tally under the DISPLAY key. A Sigma row stored as 'sigma' used to land in
       counts.sigma, where no summary row, legend entry or filter looks for it —
       so the move was genuinely classified and then counted as nothing at all.
       `|| 0` also keeps an unrecognised id from poisoning the tally with NaN,
       which would then poison every total read out of it. */
    const key = getDisplayVerdict(m.verdict);
    counts[key] = (counts[key] || 0) + 1;
    if (m.loss == null) continue; // no engine data → can't score
    if (m.verdict === 'book') { book += 1; continue; }
    const cpl = Math.min(Math.max(0, m.cpl), ACCURACY_CPL_CAP);
    cplSum += cpl; cplN += 1;
    const v = m.wpd != null ? m.wpd : winPercentDrop(m.best, m.played);
    if (v != null) { wpdSum += v; wpdN += 1; }
    scored.push({ acc: m.acc != null ? m.acc : 0, v: v != null ? v : 0 });
  }

  /* chess.com CAPS headline = the plain mean of the per-move grades. Every
     analysable row weighs 1 (book rows 1 at 100), so nothing is forgiven:
     each blunder lowers the headline by its own score's distance from 100. */
  const n = scored.length + book;
  const accSum = scored.reduce((s, r) => s + r.acc, 0) + book * 100;
  const avgCpl = cplN ? round1(cplSum / cplN) : null;
  const avgWpd = wpdN ? round1(wpdSum / wpdN) : null;
  const accuracy = n ? round1(accSum / n) : null;
  return { counts, avgCpl, avgWpd, accuracy, movesPlayed: n, total };
}

export { moveMetrics, winPercentDrop, moveAccuracy, PERFECT_VERDICTS, winPercent, winPct } from './reviewClassify.js';