/* Classification parity validator.
   Replays sample PGNs, evaluating every position with the actual deployed
   Stockfish build (full NNUE, via the UCI bridge child process), then runs
   both the OLD rule-based classifier and the NEW chess.com-style "Expected
   Points" classifier on identical engine data, printing a before/after
   per-move table and count comparison so the ~99%-match target can be
   measured against real chess.com-labelled games.

   Usage:
     node scripts/validate-classification.mjs [--time 1200] [--dir <pgn-folder>]
        [--expected <labels.json>] [--out <report.txt>]

   `--expected` takes a JSON file: { "<sample name>": [ "book","best",... ] }
   with exactly one verdict per ply (in the ply order the samples replay to).
   When provided, per-game and global match rates (OLD vs NEW) are printed.
   PGN files in `--dir` must be plain text; the first movetext line is used.

   The bridge spawns the same engine (stockfish-18-single.js = NNUE) that
   scripts/copy-stockfish.mjs deploys to public/, so calibration is done on
   the exact binary that runs in the browser.
*/

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

import { bookMoveFor } from '../src/utils/openings.js';
import { classifyMove as newClassify, heuristicIsSacrifice, winPct } from '../src/utils/reviewClassify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(__dirname, 'engine-bridge.cjs');
const MATE = 100000;

/* ------------------------- OLD (pre-change) classifier ------------------------ */
const OLD_BEST_CP = 20, OLD_MISTAKE_LOW_CP = 70, OLD_MISTAKE_HIGH_CP = 150;
const OLD_TACTIC_CP = 150, OLD_BLUNDER_CP = 300, OLD_GREAT_GAP_CP = 80;
function oldClassify({ isBook, isTopMove, sacrifice, secondM, bestM, playedM, loss }) {
  if (isBook) return 'book';
  if (bestM == null || playedM == null) return 'good';
  const engaged = bestM < 900 && bestM > -400;
  if (isTopMove) {
    if (sacrifice && engaged) return 'brilliant';
    if (secondM != null && bestM - secondM >= OLD_GREAT_GAP_CP) return 'great';
    return 'best';
  }
  if (loss >= OLD_BLUNDER_CP) return 'blunder';
  if (loss >= OLD_MISTAKE_HIGH_CP) return bestM >= OLD_TACTIC_CP ? 'miss' : 'mistake';
  if (loss >= OLD_MISTAKE_LOW_CP) return 'mistake';
  if (loss > OLD_BEST_CP) return 'good';
  return 'best';
}

/* ---------------------------------- UCI client -------------------------------- */
class UciClient {
  constructor() {
    this.proc = spawn(process.execPath, [BRIDGE], { cwd: join(__dirname, '..'), stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = '';
    this.handler = null;
    this.ready = false;
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        if (this.handler) { this.handler(line); }
      }
    });
  }
  cmd(s) { this.proc.stdin.write(s + '\n'); }
  async boot() {
    this.handler = (line) => { if (line === 'uciok') { this.ready = true; if (this.handler === onUci) this.handler = null; } };
    const onUci = this.handler;
    this.cmd('uci');
    const t0 = Date.now();
    while (!this.ready && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 20));
    if (!this.ready) throw new Error('engine did not answer uciok');
    this.handler = null;
  }
  /* MultiPV search on `fen`: resolves when bestmove arrives with the last
     info line per multipv rank (white-perspective centipawns). */
  async search(fen, { movetime, multipv = 1 }) {
    const stm = (fen.split(/\s+/)[1] || 'w') === 'w' ? 'w' : 'b';
    const ranks = {};
    const resolver = new Promise((resolve) => {
      const t = setTimeout(() => { this.handler = null; resolve(ranksTop(ranks, stm)); }, movetime + 8000);
      this.handler = (line) => {
        const parts = line.split(/\s+/);
        if (parts[0] === 'info' && parts[1] !== 'string') {
          let depth = 0, cp = null, mate = null, rank = 1, pv = null;
          for (let i = 1; i < parts.length; i++) {
            const tok = parts[i];
            if (tok === 'depth') depth = Number(parts[i + 1]);
            else if (tok === 'multipv') rank = Number(parts[i + 1]);
            else if (tok === 'score') { if (parts[i + 1] === 'cp') cp = Number(parts[i + 2]); else if (parts[i + 1] === 'mate') mate = Number(parts[i + 2]); i += 2; }
            else if (tok === 'pv') { pv = parts.slice(i + 1).filter((x) => x && x !== '(none)'); break; }
          }
          const cur = ranks[rank] || { depth: 0, cp: null, mate: null, pv: [] };
          if (depth >= cur.depth) { cur.depth = depth; if (cp != null) cur.cp = cp; if (mate != null) cur.mate = mate; if (pv) cur.pv = pv; }
          ranks[rank] = cur;
        } else if (parts[0] === 'bestmove') {
          clearTimeout(t);
          this.handler = null;
          resolve(ranksTop(ranks, stm));
        }
      };
    });
    this.cmd(`setoption name MultiPV value ${multipv}`);
    this.cmd(`position fen ${fen}`);
    this.cmd(`go movetime ${movetime}`);
    return resolver;
  }
  close() {
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    try { this.proc.kill(); } catch { /* ignore */ }
  }
}
function rankScoreWhite(stm, e) {
  if (e.mate != null) {
    const v = e.mate > 0 ? MATE - e.mate : -(MATE + e.mate);
    return stm === 'w' ? v : -v;
  }
  return stm === 'w' ? (e.cp || 0) : -(e.cp || 0);
}
function ranksTop(ranks, stm) {
  return Object.keys(ranks).map(Number).sort((a, b) => a - b).map((rank) => {
    const e = ranks[rank];
    const uci = (e.pv && e.pv[0]) || null;
    return { rank, uci, score: rankScoreWhite(stm, e), depth: e.depth };
  }).filter((m) => m.uci);
}

/* ---------------------------------- samples ---------------------------------- */
const SAMPLES = [
  { name: 'Opera Game (Morphy)', pgn: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#' },
  { name: 'Opera — black slips (synthetic)', pgn: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Kd8 12. O-O-O' },
  { name: 'Quiet Italian', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6 6. c3 a6 7. Re1 Ba7 8. Nbd2 O-O 9. Nf1 h6 10. Ng3 Re8 11. Qb3 Qe7 12. Bd2 a5' },
];

/* ---------------------------------- runner ---------------------------------- */
function parseMoves(pgn) {
  return pgn.split(/\s+/).filter((t) => !/^\d+\.$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) && !/^\d+\.\.\.$/.test(t));
}
function loadDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(pgn)$/i.test(f)).map((f) => {
    const txt = readFileSync(join(dir, f), 'utf8');
    return { name: basename(f, '.pgn'), pgn: txt };
  });
}
function loadExpected(path) {
  if (!path) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const args = {
  time: 1200,
  dir: null,
  expected: null,
  out: null,
};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--time') args.time = Number(process.argv[++i]);
  else if (process.argv[i] === '--dir') args.dir = process.argv[++i];
  else if (process.argv[i] === '--expected') args.expected = process.argv[++i];
  else if (process.argv[i] === '--out') args.out = process.argv[++i];
}

const expected = loadExpected(args.expected);
const games = [...SAMPLES, ...loadDir(args.dir)];
const report = [];
const log = (s = '') => { report.push(s); console.log(s); };

(async () => {
  const uci = new UciClient();
  await uci.boot();

  let global = { newMatches: 0, newTotal: 0, oldMatches: 0, oldTotal: 0 };

  for (const game of games) {
    const g = new Chess();
    const sans = parseMoves(game.pgn);
    const rows = [];
    const historySan = [];

    for (let i = 0; i < sans.length; i++) {
      if (g.isGameOver()) break;
      const fenBefore = g.fen();
      const mover = g.turn();
      let mv;
      try { mv = g.move(sans[i]); } catch { log(`!! illegal SAN at ply ${i + 1}: "${sans[i]}" (game truncated here)`); break; }
      historySan.push(mv.san);
      const uciStr = mv.from + mv.to + (mv.promotion || '');

      const bookLine = bookMoveFor(historySan.slice(0, -1), mv.san);
      if (bookLine) {
        rows.push({ san: mv.san, old: 'book', neu: 'book', bestM: null, playedM: null, secondM: null, winLoss: 0, book: true });
        continue;
      }

      const tops = await uci.search(fenBefore, { movetime: args.time, multipv: 4 });
      const top = tops[0] || null;
      const second = tops[1] || null;
      const bestWhite = top ? top.score : null;
      const secondWhite = second ? second.score : null;

      let playedWhite = null;
      let found = null;
      const idx = tops.findIndex((t) => t.uci === uciStr);
      if (idx >= 0) { found = tops[idx]; playedWhite = found.score; }
      else {
        const ev = await uci.search(g.fen(), { movetime: args.time, multipv: 1 });
        playedWhite = (ev[0] && ev[0].score) || null;
      }

      const p = mover === 'w' ? 1 : -1;
      const bestM = bestWhite == null ? null : p * bestWhite;
      const playedM = playedWhite == null ? null : p * playedWhite;
      const secondM = secondWhite == null ? null : p * secondWhite;

      const isTopMove = (found && found.rank === 1) || (!found && bestM != null && playedM != null && Math.abs(bestM - playedM) <= OLD_BEST_CP);
      let sacrifice = false;
      if (isTopMove) { try { sacrifice = heuristicIsSacrifice(fenBefore, mv); } catch { sacrifice = false; } }
      const loss = Math.max(0, (bestM ?? 0) - (playedM ?? 0));
      const winLoss = bestM != null && playedM != null ? Math.max(0, winPct(bestM) - winPct(playedM)) : null;

      const oldV = oldClassify({ isBook: false, isTopMove, sacrifice, secondM, bestM, playedM, loss });
      const newV = newClassify({ isBook: false, isTopMove, sacrifice, secondM, bestM, playedM });

      rows.push({ san: mv.san, old: oldV, neu: newV, bestM, playedM, secondM, winLoss, book: false, sac: sacrifice });
    }

    const oldCounts = {}, newCounts = {};
    for (const r of rows) {
      oldCounts[r.old] = (oldCounts[r.old] || 0) + 1;
      newCounts[r.neu] = (newCounts[r.neu] || 0) + 1;
    }

    log(`\n=============== ${game.name} — ${rows.length} plies (engine ${args.time}ms, MultiPV4) ===============`);
    log(' ply  san            OLD         NEW         bestM    playedM   secondM   Δwin%  (sac)');
    rows.forEach((r, i) => {
      log(` ${String(i + 1).padEnd(4)}${r.san.padEnd(14)}${r.old.padEnd(12)}${r.neu.padEnd(12)}${r.bestM == null ? '  -  ' : String(Math.round(r.bestM)).padEnd(8)}${r.playedM == null ? '  -  ' : String(Math.round(r.playedM)).padEnd(9)}${r.secondM == null ? '  -  ' : String(Math.round(r.secondM)).padEnd(9)}${r.winLoss == null ? ' - ' : (r.winLoss * 100).toFixed(1).padStart(5)}${r.sac ? '  S' : ''}`);
    });

    const changed = rows.filter((r) => r.old !== r.neu && !r.book);
    log(`\n  counts OLD : ${JSON.stringify(oldCounts)}`);
    log(`  counts NEW : ${JSON.stringify(newCounts)}`);
    log(`  changed (non-book): ${changed.length}/${rows.filter((r) => !r.book).length}`);
    changed.forEach((r) => log(`    -> ply ${rows.indexOf(r) + 1} ${r.san}: ${r.old} -> ${r.neu} (Δwin ${(r.winLoss * 100).toFixed(1)}%)`));

    if (expected && expected[game.name]) {
      const exp = expected[game.name];
      if (exp.length !== rows.length) {
        log(`  !! expected has ${exp.length} labels but game has ${rows.length} plies — skipped`);
      } else {
        let oldM = 0, newM = 0;
        rows.forEach((r, i) => {
          if (r.old === exp[i]) oldM++;
          if (r.neu === exp[i]) newM++;
        });
        const pct = (m, t) => ((m / t) * 100).toFixed(1);
        log(`  expected match -> OLD ${oldM}/${exp.length} (${pct(oldM, exp.length)}%) | NEW ${newM}/${exp.length} (${pct(newM, exp.length)}%)`);
        global.newMatches += newM; global.newTotal += exp.length;
        global.oldMatches += oldM; global.oldTotal += exp.length;
      }
    }
  }

  if (global.newTotal) {
    log('\n=====================================================================');
    log(`GLOBAL expected-labels match: OLD ${((global.oldMatches / global.oldTotal) * 100).toFixed(1)}% | NEW ${((global.newMatches / global.newTotal) * 100).toFixed(1)}%`);
  }

  uci.close();
  if (args.out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.out, report.join('\n'), 'utf8');
    log(`\nreport written to ${args.out}`);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});