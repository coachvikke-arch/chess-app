/* Does a multiPv=3 fixed-depth search return the SAME rank-1 score as a
   multiPv=1 fixed-depth search on the same position?

   This is the load-bearing assumption behind memoising the review pipeline:
   gameReview evaluates `fenAfter_i` via evaluateGame (multiPv 1) and then
   searches `fenBefore_{i+1}` — which IS `fenAfter_i` — via searchTopMoves
   (multiPv 3). If rank-1 were identical we could serve one from the other.

   Run: node scripts/probe-multipv-equivalence.mjs [--plies 40] [--depth 18]
*/
import { Chess } from 'chess.js';
import { createReviewEnginePool } from './nodeEngine.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const PLIES = arg('plies', 40);
const DEPTH = arg('depth', 18);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* deterministic legal game, mirrors the determinism harness generator */
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

const engine = await createReviewEnginePool({ hashMb: 128, size: 3 });
const san = generateGame(PLIES);

// collect every distinct position the review would touch (fenBefore of each ply)
const positions = [];
{
  const g = new Chess();
  for (const s of san) {
    positions.push(g.fen());
    if (!g.move(s)) break;
  }
}

console.log(`probing ${positions.length} positions at depth ${DEPTH} (multiPv 3 vs multiPv 1)…\n`);

let same = 0, diffScore = 0, diffUci = 0, diffDepth = 0;
const diffs = [];

for (const fen of positions) {
  const [tops, ev] = await Promise.all([
    engine.searchTopMoves(fen, { maxDepth: DEPTH, multiPv: 3 }),
    engine.evaluateGame(fen, { maxDepth: DEPTH }),
  ]);
  const r1 = tops.find((t) => t.rank === 1) || tops[0];
  if (!r1 || !ev) { continue; }

  const scoreEq = r1.score === ev.score;
  const uciEq = r1.uci === (ev.uci ?? r1.uci); // evaluateGame may not expose uci
  const depthEq = (r1.depth || 0) === (ev.depth || 0);

  if (scoreEq && uciEq && depthEq) same++;
  else {
    if (!scoreEq) { diffScore++; diffs.push({ fen, kind: 'score', multi: r1.score, single: ev.score }); }
    if (!depthEq) { diffDepth++; diffs.push({ fen, kind: 'depth', multi: r1.depth, single: ev.depth }); }
    if (!uciEq) { diffUci++; diffs.push({ fen, kind: 'uci', multi: r1.uci, single: ev.uci }); }
  }
}

console.log(`identical (score+uci+depth): ${same}/${positions.length}`);
console.log(`  score mismatches: ${diffScore}`);
console.log(`  depth mismatches: ${diffDepth}`);
console.log(`  uci   mismatches: ${diffUci}`);
if (diffs.length) {
  console.log('\nfirst differences:');
  for (const d of diffs.slice(0, 12)) {
    console.log(`  [${d.kind}] ${d.fen}`);
    console.log(`     multiPv3 → ${d.multi}   multiPv1 → ${d.single}`);
  }
}

await engine.destroy();
process.exit(same === positions.length ? 0 : 1);
