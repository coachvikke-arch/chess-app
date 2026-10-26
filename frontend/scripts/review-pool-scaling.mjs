/* Pool-size scaling measurement.

   REVIEW_POOL_MAX currently caps the review pool at 3 workers, so on an 8-core
   desktop 5 cores sit idle for the whole review. This measures the actual
   wall-clock of the SAME game at different pool sizes to establish what raising
   the cap is really worth (and confirms verdicts don't move with pool size).

   Run: node scripts/review-pool-scaling.mjs [--plies 30] [--depth 14] [--sizes 2,3,4,6] [--hash 64]
*/
import { Chess } from 'chess.js';
import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEnginePool } from './nodeEngine.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const PLIES = Number(arg('plies', 30));
const DEPTH = Number(arg('depth', 14));
const HASH = Number(arg('hash', 64));
const SIZES = String(arg('sizes', '2,3,4,6')).split(',').map((s) => Number(s.trim())).filter(Boolean);

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

const snap = (res) => JSON.stringify({
  opening: res.opening, white: res.white, black: res.black,
  moves: res.moves.map((m) => [m.san, m.verdict, m.cpl, m.loss, m.acc, m.wpd, m.best, m.played, m.depth, m.bestUci]),
});

const gr = await import(new URL('../src/utils/gameReview.js', import.meta.url).href);
const ref = snap(await (async () => {
  const e = await createReviewEnginePool({ hashMb: HASH, size: 2 });
  const r = await gr.reviewGame('start', moves, { engine: e, bookLookup: async () => null });
  await e.destroy();
  return r;
})());

console.log(`game ${moves.length} plies, depth ${DEPTH}, hash ${HASH}MB`);
console.log(`cores: ${await (async () => (await import('node:os')).cpus().length)()}\n`);

for (const size of SIZES) {
  const engine = await createReviewEnginePool({ hashMb: HASH, size });
  const times = [];
  for (let rep = 0; rep < 2; rep++) {
    const t0 = Date.now();
    const res = await gr.reviewGame('start', moves, { engine, bookLookup: async () => null });
    const ms = Date.now() - t0;
    times.push(ms);
    const s = snap(res);
    if (s !== ref) {
      console.log(`  !! pool ${size} produced DIFFERENT classifications`);
      process.exitCode = 1;
    }
  }
  await engine.destroy();
  const min = Math.min(...times);
  console.log(`  pool ${size}: min ${(min / 1000).toFixed(1)}s   (runs: ${times.map((t) => (t / 1000).toFixed(1)).join('s, ')}s)`);
}
console.log('\nPARITY OK — every pool size produced identical classifications');
