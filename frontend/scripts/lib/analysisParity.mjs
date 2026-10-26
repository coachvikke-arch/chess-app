/* Shared A=B=C comparison for the three analysis surfaces.
 *
 *   A = Game Review  (reviewGame with defaults, exactly what reviewRunner runs)
 *   B = Chess Profile (analyzeCanonical, the component's own call)
 *   C = GM Game       (analyzeGmGame, the replay's own call)
 *
 * Every adapter must run the same canonical pipeline with the same engine
 * config, so the compared fields must be deeply identical — no tolerances.
 * Floating point is canonical-normalized upstream (rounded CPL/scores,
 * round1 accuracies), so exact equality is the correct assertion.
 */
import assert from 'node:assert/strict';
import { aggregateSide } from '../../src/utils/reviewAccuracy.js';

const ROW_FIELDS = ['san', 'uci', 'verdict', 'cpl', 'loss', 'swing', 'best',
  'played', 'wpd', 'acc', 'bestUci', 'bestSan', 'forced', 'sacrifice',
  'sacrificeProtected'];

/* The canonical identity of one analysed ply: every metric the spec requires
 * compared (best/played scores, CPL, WPD, verdict, Sigma status + type,
 * forced status, sacrifice status, accuracy, engine lines), in game order. */
export function comparableRows(entries) {
  return entries.map((m) => {
    const row = {};
    for (const f of ROW_FIELDS) row[f] = m[f] ?? null;
    row.sigma = m.sigma
      ? {
        type: m.sigma.type ?? null,
        piece: m.sigma.piece ?? null,
        rank: m.sigma.rank ?? null,
        fromSquare: m.sigma.fromSquare ?? null,
        toSquare: m.sigma.toSquare ?? null,
      }
      : null;
    row.lines = (m.lines || []).map((l) => [l.uci, l.score ?? null, l.mate ?? null]);
    return row;
  });
}

export function sigmaSans(entries) {
  return entries
    .filter((m) => m.verdict === 'sigma' || m.verdict === 'brilliant')
    .map((m) => m.san);
}

/* resA/resB are full reviewGame results; entriesC is the GM adapter's mapped
 * rows (same canonical fields by contract). Aggregates for C are re-aggregated
 * with the canonical aggregator — the same function that produced A/B. */
export function assertSurfacesEqual(resA, resB, entriesC, label) {
  const a = comparableRows(resA.moves);
  const b = comparableRows(resB.moves);
  const c = comparableRows(entriesC);
  assert.deepEqual(b, a, `${label}: Chess Profile differs from Game Review`);
  assert.deepEqual(c, a, `${label}: GM Game differs from Game Review`);

  assert.deepEqual(resB.white.accuracy, resA.white.accuracy, `${label}: white accuracy differs (profile)`);
  assert.deepEqual(resB.black.accuracy, resA.black.accuracy, `${label}: black accuracy differs (profile)`);
  for (const side of ['w', 'b']) {
    const agg = aggregateSide(entriesC, side, {});
    const key = side === 'w' ? 'white' : 'black';
    assert.deepEqual(agg.accuracy, resA[key].accuracy, `${label}: ${key} accuracy differs (gm)`);
  }

  assert.deepEqual(sigmaSans(resB.moves), sigmaSans(resA.moves), `${label}: sigma set differs (profile)`);
  assert.deepEqual(sigmaSans(entriesC), sigmaSans(resA.moves), `${label}: sigma set differs (gm)`);
  return a;
}

export function assertNoSigma(entries, label) {
  const found = sigmaSans(entries);
  assert.deepEqual(found, [], `${label}: expected no Sigma, found ${found.join(', ')}`);
}
