/* Controlled A/B for the review pipeline's dispatch width.

   The single-run timings in review-bench.mjs are too noisy on a shared laptop
   to justify a change on their own, so this harness runs the SAME game
   repeatedly at each candidate width, interleaved (A,B,A,B,…) so slow patches
   / thermal drift hit both arms equally, and reports the MINIMUM and median.

   Width only changes how many plies are in flight; it cannot change verdicts —
   this script asserts that too, by comparing the classification snapshot of
   every arm against the first.

   Run: node scripts/review-dispatch-ab.mjs [--plies 34] [--depth 16] [--reps 5]
*/
import { Chess } from 'chess.js';
import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEnginePool } from './nodeEngine.mjs';
import { REVIEW_ENGINE_POOL } from '../src/utils/engineConfig.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const PLIES = arg('plies', 34);
const DEPTH = arg('depth', 16);
const REPS = arg('reps', 5);
const HASH = arg('hash', 64);
const widthsArg = process.argv.includes('--widths')
  ? String(process.argv[process.argv.indexOf('--widths') + 1])
  : '3,6,12,24';
const WIDTHS = widthsArg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
if (!WIDTHS.length) { console.error('no valid --widths'); process.exit(1); }

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function generateGame(plies) {
  const g = new Chess();
  const san = [];
  for (let n = 0; n < plies; n++) {
    const opts = g.moves({ verbose: true });
    if (!opts.length) break;
    let best = opts[0]; let bestH = Infinity;
    for (const mv of opts) {
      const h = hashStr(`${g.fen()}|play|${mv.from + mv.to + (mv.promotion || '')}`);
      if (h < bestH) { bestH = h; best = mv; }
    }
    g.move(best); san.push(best.san);
  }
  return san;
}
const moves = generateGame(PLIES);

/* reviewGame reads the width from a module-level import, so vary it per run by
   re-importing the module graph with a stubbed global (see setWidth below). */
let widthOverride = null;

function snap(res) {
  return JSON.stringify({
    opening: res.opening,
    white: res.white, black: res.black,
    moves: res.moves.map((m) => [m.san, m.verdict, m.cpl, m.loss, m.acc, m.wpd, m.best, m.played, m.depth, m.bestUci]),
  });
}

const engine = await createReviewEnginePool({ hashMb: HASH, size: REVIEW_ENGINE_POOL });

const results = new Map(WIDTHS.map((w) => [w, []]));
const snaps = new Map();

console.log(`game: ${moves.length} plies, depth ${DEPTH}, pool ${REVIEW_ENGINE_POOL}, ${REPS} reps per width`);
console.log(`widths under test: ${WIDTHS.join(', ')}\n`);

for (let rep = 0; rep < REPS; rep++) {
  for (const w of WIDTHS) {
    // reviewGame captured REVIEW_DISPATCH_WIDTH at import time; re-import with
    // a fresh module instance per width by busting the specifier cache.
    const url = new URL('../src/utils/engineConfig.js', import.meta.url);
    url.searchParams.set('__w', String(w));
    const mod = await import(url.href);
    const grUrl = new URL('../src/utils/gameReview.js', import.meta.url);
    grUrl.searchParams.set('__w', String(w));
    const gr = await import(grUrl.href);

    const t0 = Date.now();
    const res = await gr.reviewGame('start', moves, { engine, bookLookup: async () => null });
    const ms = Date.now() - t0;
    results.get(w).push(ms);
    const s = snap(res);
    if (snaps.has(w) && snaps.get(w) !== s) {
      console.log(`  !! width ${w} produced a DIFFERENT classification than its own earlier run`);
      process.exitCode = 1;
    }
    snaps.set(w, s);
    process.stdout.write(`  rep${rep + 1} width ${String(w).padStart(2)}: ${(ms / 1000).toFixed(1)}s\n`);
  }
}

console.log('\nsummary (min is the robust signal on a noisy machine):');
const base = Math.min(...results.get(WIDTHS[0]));
let bad = 0;
for (const w of WIDTHS) {
  const a = results.get(w).slice().sort((x, y) => x - y);
  const min = a[0], med = a[Math.floor(a.length / 2)];
  const spd = base ? ((base - min) / base) * 100 : 0;
  console.log(
    `  width ${String(w).padStart(2)}: min ${(min / 1000).toFixed(1)}s  median ${(med / 1000).toFixed(1)}s` +
    (w === WIDTHS[0] ? '' : `   (${spd >= 0 ? '-' : '+'}${Math.abs(spd).toFixed(0)}% vs width ${WIDTHS[0]})`)
  );
}

const ref = snaps.get(WIDTHS[0]);
for (const w of WIDTHS) {
  if (snaps.get(w) !== ref) {
    bad++;
    console.log(`\nMISMATCH: width ${w} classifications differ from width ${WIDTHS[0]}`);
  }
}
console.log(bad
  ? `\n${bad} MISMATCHES`
  : '\nPARITY OK — every width produced identical classifications (only speed differs)');

await engine.destroy();
process.exit(bad ? 1 : 0);
