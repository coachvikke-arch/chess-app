/* Chess.com game-review validator — replay real chess.com games with OUR
   fixed-depth engine + win%-drop classification and compare per-move labels
   and accuracies against what chess.com reported (transcribed into
   scripts/data/chesscom-corpus.json).

   Readiness: a corpus of ~20 real games gets a meaningful verdict-match rate;
   the included `examples` block is a self-consistent smoke fixture only.
   Target: ≥ 90% per-move verdict agreement, accuracy within ±3 (a ±3–5%
   residual from engine version/depth differences vs chess.com is expected —
   chess.com uses a deeper/different SF build).

   Usage (from frontend/):
     node scripts/compare-chesscom.mjs [--depth 18] [--multiPv 2]
         [--maxGames 20] [--quick] [--offline] [--report report.json]
   --quick    depth 12 (plumbing smoke test on the example)
   --offline  stub the opening book offline (no Lichess Explorer network)
   --report   also write a machine-readable JSON report

   Exit codes: 0 = met targets, 1 = below targets, 2 = data/engine error.
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { createReviewEnginePool, createReviewEngine } from './nodeEngine.mjs';
import { reviewGame } from '../src/utils/gameReview.js';
import { bookMoveFor } from '../src/utils/openings.js';
import { REVIEW_DEPTH, REVIEW_MULTIPV } from '../src/utils/reviewConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(join(__dirname, 'data', 'chesscom-corpus.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = { depth: REVIEW_DEPTH, multiPv: REVIEW_MULTIPV, maxGames: Infinity };
let quick = false, offline = false, reportPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--depth') opt.depth = Number(args[++i]);
  else if (a === '--multiPv') opt.multiPv = Number(args[++i]);
  else if (a === '--maxGames') opt.maxGames = Number(args[++i]);
  else if (a === '--quick' || a === '-q') quick = true;
  else if (a === '--offline') offline = true;
  else if (a === '--report') reportPath = args[++i];
}
if (quick) opt.depth = Math.min(12, opt.depth);

const LABEL_OF = (lbl) => (CORPUS.labelMap || {})[lbl] || lbl;

function loadPgnMoves(pgn) {
  const g = new Chess();
  g.loadPgn(pgn);
  return g.history();
}

/* Corpus `moves` accept either [san, label] pairs or { white: [san,label],
   black: [san,label] } turn objects — flatten to a single SAN→label stream. */
function flattenCorpusMoves(game) {
  const rows = [];
  for (const mv of game.moves) {
    if (Array.isArray(mv)) rows.push(mv);
    else if (mv.san) rows.push([mv.san, mv.label]);
    else {
      if (mv.white) rows.push(mv.white);
      if (mv.black) rows.push(mv.black);
    }
  }
  return rows;
}

/* Run one game through the real pipeline (engine + our book + our classify)
   and align our rows with the corpus per-move labels by SAN. */
async function reviewCorpusGame(engine, game, bookLookup) {
  const sans = loadPgnMoves(game.pgn);
  const res = await reviewGame('start', sans, {
    engine,
    engineOverrides: { depth: opt.depth, multiPv: opt.multiPv },
    bookLookup,
  });
  if (!res) return { moves: [], accuracy: null };

  const ourBySan = new Map();
  for (const m of res.moves) ourBySan.set(m.san, m);

  const aligned = [];
  for (const [oursan, theirVerdict] of flattenCorpusMoves(game)) {
    const our = ourBySan.get(oursan);
    aligned.push({
      san: oursan,
      theirs: LABEL_OF(theirVerdict),
      ours: our ? our.verdict : 'fscked',
      cpl: our ? our.cpl : null,
      acc: our ? our.acc : null,
      wpd: our ? our.wpd : null,
      depth: our ? our.depth : 0,
    });
  }
  return { moves: aligned, accuracy: res.white && res.black ? { white: res.white.accuracy, black: res.black.accuracy } : null };
}

const engine = process.env.CORPUS_SERIAL === '1' ? await createReviewEngine() : await createReviewEnginePool();
const bookLookup = offline
  ? async (pl) => { try { return bookMoveFor(pl.historySan, pl.san); } catch { return null; } }
  : undefined;

const games = CORPUS.games.length ? CORPUS.games : (quick ? CORPUS.examples : []);
const pool = games.slice(0, opt.maxGames);

let totMoves = 0, totMatch = 0, accDeltas = [], perVerdict = {}, perGame = [];
console.log(`Comparing ${pool.length} game(s) @ depth ${opt.depth} multiPv ${opt.multiPv}${offline ? ' (offline book)' : ''}\n`);

for (const [gi, game] of pool.entries()) {
  const t0 = Date.now();
  let r;
  try {
    r = await reviewCorpusGame(engine, game, bookLookup);
  } catch (err) {
    console.log(`  [${gi + 1}/${pool.length}] ${game.id || '?'} — ENGINE ERROR: ${err.message}`);
    continue;
  }
  const dt = Math.round((Date.now() - t0) / 1000);

  const mn = (pi) => Math.floor(pi / 2) + 1;
  const sideLbl = (pi) => (pi % 2 === 0 ? 'W' : 'B');

  let gm = 0, gx = 0;
  r.moves.forEach((m, pi) => {
    const hit = m.theirs === m.ours;
    if (hit) gx++; else gm++;
    totMoves++; if (hit) totMatch++;
    perVerdict[m.theirs] = perVerdict[m.theirs] || { n: 0, ok: 0 };
    perVerdict[m.theirs].n++; if (hit) perVerdict[m.theirs].ok++;
    const mark = hit ? '  ' : '× ';
    console.log(`     ${mark}${String(mn(pi)).padStart(2)}${sideLbl(pi) === 'W' ? '.' : '…'} ${(m.san || '').padEnd(6)} chess.com=${(m.theirs || '').padEnd(11)} ours=${(m.ours || '').padEnd(11)} cpl=${m.cpl}`);
  });

  const accText = r.accuracy
    ? ` acc ${game.accuracy.white}→${r.accuracy.white} / ${game.accuracy.black}→${r.accuracy.black}`
    : '';
  const pct = r.moves.length ? Math.round((gx / r.moves.length) * 1000) / 10 : 100;
  console.log(`  [${gi + 1}/${pool.length}] ${game.id || '?'} — ${pct}% verdict match (${gx}/${r.moves.length}) in ${dt}s${accText}\n`);
  for (const side of ['white', 'black']) {
    if (game.accuracy?.[side] != null && r.accuracy?.[side] != null) {
      accDeltas.push({ game: game.id, side, delta: Math.round((game.accuracy[side] - r.accuracy[side]) * 10) / 10 });
    }
  }
  perGame.push({ id: game.id, pct, n: r.moves.length });
}

engine.destroy();

const overall = totMoves ? Math.round((totMatch / totMoves) * 1000) / 10 : 100;
let mae = null;
if (accDeltas.length) {
  mae = Math.round((accDeltas.reduce((s, d) => s + Math.abs(d.delta), 0) / accDeltas.length) * 10) / 10;
}

console.log('\n══════════════════════════════════════════════════');
console.log(`per-move verdict agreement: ${overall}%  (${totMatch}/${totMoves})`);
if (mae != null) console.log(`accuracy MAE: ±${mae} (vs chess.com reported accuracy)`);
else console.log('accuracy MAE: n/a (corpus game accuracy not transcribed)');
if (perGame.length) console.log(`games: ${perGame.map((g) => `${g.id}=${g.pct}%`).join('  ')}`);
console.log('\nper-verdict agreement (chess.com label → our match):');
for (const [k, v] of Object.entries(perVerdict).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(11)} ${v.ok}/${v.n}  (${Math.round((v.ok / v.n) * 100)}%)`);
}

const met = (totMoves >= 20 && overall >= 90 && (mae == null || mae <= 3.0));
if (reportPath) {
  writeFileSync(resolve(process.cwd(), reportPath), JSON.stringify({ overall, mae, perGame, perVerdict, accDeltas }, null, 2));
}
console.log(met ? '\nTARGETS MET (validation green)' : `\n${totMoves < 20 ? 'need ≥20 corpus moves (transcribe real chess.com games)' : 'BELOW TARGET (see mismatch rows above)'}`);
process.exit(met ? 0 : 1);