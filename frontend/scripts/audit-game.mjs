/* Audit a reviewed game against the REAL Stockfish engine.
   Replays the game through chess.js, drives the bundled Stockfish.js 18
   subprocess (Node UCI mode) with the exact same FIXED-DEPTH MultiPV setup the
   in-browser review pipeline uses, computes each move's verdict with the real
   reviewClassify rules, and prints a per-move audit table + per-player tallies.

   Usage: node scripts/audit-game.mjs
*/

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { classifyMove, moveMetrics, sacrificeCandidate, settledNetSacrifice, isQuietPosition, moveAccuracy, winPercentDrop, withTrustFloor } from '../src/utils/reviewClassify.js';
import { bookMoveFor, resolveBookMove } from '../src/utils/openings.js';
import {
  MATE_SCORE,
  REVIEW_DEPTH,
  REVIEW_MULTIPV,
  REVIEW_HASH_MB,
  REVIEW_MIN_TRUST_DEPTH,
  FORCED_SECOND_LOSS_CP,
  GREAT_MIN_GAP_CP,
  GREAT_NEEDS_SHARP_POSITION,
  BRILLIANT_NEAR_BEST_CPL,
  BRILLIANT_EVAL_MIN,
  BRILLIANT_EVAL_MAX,
  BRILLIANT_SETTLED_MAX_PLIES,
  SAFE_ALT_EVAL_CP,
  ACCURACY_CPL_CAP,
} from '../src/utils/reviewConfig.js';
import { REVIEW_ORDER } from '../src/utils/gameReview.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const PER_SEARCH_TIMEOUT_MS = 130000;

/* Stage a CommonJS copy of the engine + wasm in the temp dir. The bundled
   stockfish.js is authored as CJS, but frontend/package.json has
   "type": "module", so a `.js` filename loads as ESM in Node and crashes on
   the embedded `require(...)` calls. A `.cjs` copy runs in the engine's
   native Node main-module UCI mode (readline on stdin, prints to stdout),
   and resolves `stockfish.wasm` relative to __dirname. */
function ensureEngineCopy() {
  const dest = join(tmpdir(), 'chess-academy-sf', 'stockfish.cjs');
  const wasmDest = join(tmpdir(), 'chess-academy-sf', 'stockfish.wasm');
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest) || !existsSync(wasmDest)) {
    copyFileSync(join(PUBLIC_DIR, 'stockfish.js'), dest);
    copyFileSync(join(PUBLIC_DIR, 'stockfish.wasm'), wasmDest);
  }
  return dest;
}

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.28"]
[Round "?"]
[White "M8-Zone"]
[Black "Nagavel_Krishnamoorthi"]
[Result "1-0"]
[TimeControl "600"]
[WhiteElo "1569"]
[BlackElo "1392"]
[Termination "M8-Zone won by resignation"]
[ECO "D00"]
[EndTime "17:25:48 GMT+0000"]
[Link "https://www.chess.com/game/live/173662815880?username=m8-zone&move=0"]

1. d4 d5 2. Bf4 Bf5 3. e3 e6 4. Nf3 h6 5. c3 a6 6. Bd3 Ne7 7. Bc2 Nbc6 8. Nbd2
g6 9. Ne5 Bg7 10. Nxc6 Nxc6 11. Ba4 Qd7 12. Nf1 O-O-O 13. g4 g5 14. gxf5 gxf4
15. fxe6 Qxe6 16. Qf3 fxe3 17. Nxe3 b5 18. Bb3 Qe4 19. Bxd5 Qxf3 20. Bxf3 Kb7
21. O-O-O Rd7 22. Ng4 Kb6 23. Bxc6 Kxc6 24. Rde1 h5 25. Ne3 Bh6 26. Rhg1 Re8 27.
Kc2 Rde7 28. Kd3 Kb6 29. Nd5+ 1-0`;

/* ----------------------------- engine driver ----------------------------- */

function startEngine() {
  const proc = spawn(process.execPath, [ensureEngineCopy()], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiters = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].check(line)) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(line);
        }
      }
    }
  });
  return {
    proc,
    writeln(cmd) {
      proc.stdin.write(cmd + '\n');
    },
    waitFor(check, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.check === check);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`timeout waiting for engine response: ${check}`));
        }, timeoutMs);
        waiters.push({ check, resolve: (line) => { clearTimeout(timer); resolve(line); } });
      });
    },
  };
}

async function initEngine(sf) {
  sf.writeln('uci');
  await sf.waitFor((l) => l.startsWith('uciok'), 20000);
  sf.writeln('setoption name Threads value 1');
  sf.writeln(`setoption name Hash value ${REVIEW_HASH_MB}`);
  sf.writeln('setoption name Ponder value false');
  sf.writeln('setoption name UCI_LimitStrength value false');
  sf.writeln('setoption name Skill Level value 20');
  sf.writeln('isready');
  await sf.waitFor((l) => l.startsWith('readyok'), 20000);
}

/* One fixed-depth search; collects ranks exactly like stockfish.js does.
   Returns { moves: [{ rank, uci, score (white-persp cp), depth }], ptMs }. */
async function runSearch(sf, fen, { maxDepth, multiPv }) {
  sf.writeln(`setoption name MultiPV value ${multiPv}`);
  sf.writeln(`position fen ${fen}`);
  sf.writeln(`go depth ${maxDepth}`);
  const ranks = {};
  const start = performance.now();
  let bestmoveLine;
  try {
    bestmoveLine = await sf.waitFor((line) => {
      if (line.startsWith('info')) {
        const parts = line.split(/\s+/);
        let depth = 0, cp = null, mate = null, rank = 1, pv = null;
        for (let i = 1; i < parts.length; i++) {
          const tok = parts[i];
          if (tok === 'depth') depth = Number(parts[i + 1]);
          else if (tok === 'multipv') rank = Number(parts[i + 1]);
          else if (tok === 'score') {
            if (parts[i + 1] === 'cp') cp = Number(parts[i + 2]);
            else if (parts[i + 1] === 'mate') mate = Number(parts[i + 2]);
            i += 2;
          } else if (tok === 'pv') {
            pv = parts.slice(i + 1).filter((x) => x && x !== '(none)');
            break;
          }
        }
        const entry = ranks[rank] || { depth: 0, cp: null, mate: null, pv: [] };
        if (depth >= entry.depth) {
          entry.depth = depth;
          if (cp != null) entry.cp = cp;
          if (mate != null) entry.mate = mate;
          if (pv) entry.pv = pv;
        }
        ranks[rank] = entry;
      }
      return line.startsWith('bestmove');
    }, PER_SEARCH_TIMEOUT_MS);
  } catch (err) {
    // A slow/stuck search must not sink the whole run: tell the engine to stop
    // and drain its pending "bestmove" so the next search starts from a clean,
    // idle engine. The ply itself is reported as failed by the caller.
    sf.writeln('stop');
    await sf.waitFor((l) => l.startsWith('bestmove'), 8000).catch(() => {});
    throw err;
  }

  const bm = (bestmoveLine.split(/\s+/)[1] || '').replace(/\(none\)/g, '').trim();
  const stm = (fen.split(/\s+/)[1] || 'w') === 'w' ? 'w' : 'b';
  const movelist = Object.keys(ranks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((rank) => {
      const entry = ranks[rank];
      const uci = (entry.pv && entry.pv[0]) || (rank === 1 && bm ? bm : null);
      if (!uci) return null;
      let score;
      if (entry.mate != null) {
        const sm = entry.mate;
        const stmScore = sm > 0 ? MATE_SCORE - sm : -(MATE_SCORE + sm);
        score = stm === 'w' ? stmScore : -stmScore;
      } else {
        const cp = entry.cp == null ? 0 : entry.cp;
        score = stm === 'w' ? cp : -cp;
      }
      return { rank, uci, score, depth: entry.depth };
    })
    .filter(Boolean);
  const ptMs = Math.round(performance.now() - start);
  return { moves: movelist, ptMs, bestmove: bm };
}

function gamePhase(fen, ply) {
  if (ply <= 8) return 'opening';
  const board = fen.split(' ')[0];
  const heavy = (board.match(/[NBRQnbrq]/g) || []).length;
  const queens = (board.match(/[Qq]/g) || []).length;
  if (queens === 0 && heavy <= 6) return 'endgame';
  return 'middlegame';
}

/* -------------------------------- main ---------------------------------- */

const sf = startEngine();
await initEngine(sf);

const g0 = new Chess();
g0.loadPgn(PGN);
const sans = g0.history();

const g = new Chess();
const historySan = [];
const results = [];
const t0 = performance.now();
let prevMv = null;

for (let i = 0; i < sans.length; i++) {
  const fenBefore = g.fen();
  const mover = g.turn();
  const phase = gamePhase(fenBefore, i);
  const legalCount = g.moves().length;
  const mv = g.move(sans[i]);
  const prev = prevMv;
  prevMv = mv;
  historySan.push(mv.san);
  const uci = mv.from + mv.to + (mv.promotion || '');
  /* production book resolver (Lichess Explorer, gated by game frequency),
     falling back to the offline curated book when the API is unreachable. */
  let bookLine = null;
  try {
    bookLine = await resolveBookMove({ fenBefore, historySan: historySan.slice(0, -1), san: mv.san });
  } catch {
    bookLine = bookMoveFor(historySan.slice(0, -1), mv.san);
  }
  const isBook = Boolean(bookLine);

  let bestM = null, playedM = null, secondM = null, found = null, tops = [], maxDepth = 14;
  try {
    maxDepth = isBook ? Math.min(REVIEW_DEPTH, 12) : REVIEW_DEPTH;
    const r = await runSearch(sf, fenBefore, { maxDepth, multiPv: REVIEW_MULTIPV });
    tops = r.moves;
    const seenDepth = Math.max(...tops.map((t) => t.depth || 0), 0);
    const bestWhite = tops[0] && tops[0].score != null ? tops[0].score : null;
    const secondWhite = tops[1] ? tops[1].score : null;

    let playedWhite = null;
    let playedDepth = 0;
    found = tops.find((t) => t.uci === uci);
    if (found) {
      playedWhite = found.score;
      playedDepth = found.depth || 0;
    } else {
      const ev = await runSearch(sf, g.fen(), { maxDepth, multiPv: 1 });
      const best = ev.moves[0];
      playedWhite = best ? best.score : 0;
      playedDepth = best ? best.depth || 0 : 0;
    }

    const p = mover === 'w' ? 1 : -1;
    bestM = bestWhite == null ? null : p * bestWhite;
    playedM = playedWhite == null ? null : p * playedWhite;
    secondM = secondWhite == null ? null : p * secondWhite;

    const isBestMove = Boolean(found && found.rank === 1);
    const isForced = legalCount === 1
      || (bestM != null && secondM != null && bestM - secondM >= FORCED_SECOND_LOSS_CP);
    const { cpl, swing } = moveMetrics(bestM, playedM);
    const wpd = bestM != null && playedM != null ? winPercentDrop(bestM, playedM) : null;

    /* Brilliant inputs — mirror of gameReview.js (near-best: best or within
       BRILLIANT_NEAR_BEST_CPL — chess.com's "best or near-best", so a rank-2
       sacrifice by a 2cp engine-noise gap like 19.Bxd5 still qualifies) */
    const nearBest = bestM != null && playedM != null && cpl <= BRILLIANT_NEAR_BEST_CPL;
    const inBrilliantWindow = bestM != null && bestM > BRILLIANT_EVAL_MIN && bestM < BRILLIANT_EVAL_MAX;

    let sacrifice = false;
    if (nearBest && inBrilliantWindow && !isForced && legalCount > 1) {
      try { sacrifice = sacrificeCandidate(fenBefore, mv, prev); } catch { sacrifice = false; }
    }

    let hasSafeAlternative = false;
    if (!isForced) {
      const altWhite = tops
        .filter((t) => t.uci !== uci && t.score != null)
        .find((t) => (mover === 'w' ? t.score : -t.score) > SAFE_ALT_EVAL_CP);
      hasSafeAlternative = Boolean(altWhite);
    }

    /* Brilliant-2b net-trade guard — mirror of gameReview.js: settle the full
       forced capture/check continuation after the played move (extra fixed-
       depth multiPv-1 search). Brilliant stays when the offered piece is never
       taken (poisoned/declined invitation) or the mover keeps PRESSING with a
       follow-up capture/check (settled.pressed); it is stripped — a trade —
       only when the offer is captured and no pressing follow-up exists. */
    let hasNetSacrifice = true;
    if (sacrifice && nearBest && inBrilliantWindow && !isForced && legalCount > 1) {
      try {
        const line = await runSearch(sf, g.fen(), { maxDepth: REVIEW_DEPTH, multiPv: 1 });
        const best = line.moves && line.moves[0];
        const pv = best && Array.isArray(best.pv) && best.pv.length ? best.pv : null;
        const settled = settledNetSacrifice(fenBefore, mover, uci, pv, BRILLIANT_SETTLED_MAX_PLIES);
        hasNetSacrifice = !settled ? true : (!settled.offeredTaken || settled.pressed);
      } catch { hasNetSacrifice = true; }
    }

    /* Great's optional sharpness gate — quiet positions (no check/capture of
       our side) get no "!". Pure chess.js, only for real Great candidates. */
    let isSharp = true;
    if (GREAT_NEEDS_SHARP_POSITION && nearBest && !isForced && secondM != null
      && bestM != null && bestM - secondM >= GREAT_MIN_GAP_CP) {
      try { isSharp = !isQuietPosition(fenBefore); } catch { isSharp = true; }
    }

    const verdictRaw = classifyMove({
      isBook, isBestMove, sacrifice, hasSafeAlternative, hasNetSacrifice, isSharp,
      secondM, bestM, playedM, isForced,
      moveNumber: Math.floor(i / 2) + 1,
    });
    const trusted = isBook || seenDepth >= REVIEW_MIN_TRUST_DEPTH;
    const verdict = withTrustFloor(verdictRaw, trusted);
    const loss = bestM != null && playedM != null ? cpl : null;
    results.push({
      ply: i, player: mover, san: mv.san, uci, verdict,
      cpl: loss == null ? 0 : Math.min(ACCURACY_CPL_CAP, cpl),
      loss, swing, wpd,
      acc: loss == null ? null : moveAccuracy(bestM, playedM, verdict),
      best: bestM == null ? null : Math.round(bestM),
      played: playedM == null ? null : Math.round(playedM),
      bestUci: tops[0] ? tops[0].uci : null,
      bestMoveSan: tops[0] ? null : null,
      depth: Math.max(seenDepth, playedDepth),
      bookLine: bookLine ? bookLine.name : null,
      ttMs: r.ptMs + (found ? 0 : 0),
    });
    // annotate best move SAN
    if (tops[0]) {
      const tg = new Chess(fenBefore);
      try {
        const bm = tg.move({ from: tops[0].uci.slice(0, 2), to: tops[0].uci.slice(2, 4), promotion: tops[0].uci.length > 4 ? tops[0].uci[4] : undefined });
        if (bm) results[results.length - 1].bestMoveSan = bm.san;
      } catch { results[results.length - 1].bestMoveSan = tops[0].uci; }
    }
  } catch (err) {
    console.error(`engine failed on ply ${i} (${mv.san}):`, err.message);
    results.push({
      ply: i, player: mover, san: mv.san, uci,
      verdict: isBook ? 'book' : 'good', cpl: 0, loss: null, swing: null, wpd: null,
      best: null, played: null, bestUci: null, bestMoveSan: null,
      depth: 0, bookLine: bookLine ? bookLine.name : null, ttMs: 0,
    });
    continue;
  }

  process.stdout.write(`\rply ${i + 1}/${sans.length} (${mv.san}) — ${Math.round((performance.now() - t0) / 1000)}s  `);
}

process.stdout.write('\n');

/* ------------------------------ reporting ------------------------------- */

const LABEL = { brilliant: 'Sigma', great: 'Great Move', best: 'Best', excellent: 'Nice', good: 'Ok', book: 'Theoretical', inaccuracy: 'Strange', mistake: 'Bad', miss: 'Miss', blunder: 'Clown' };

console.log('\n#   mv  ply  side  san    verdict       cpl  wpd   swing  best   played  nextcanon        depth  time   book-line');
results.forEach((r) => {
  const mn = Math.floor(r.ply / 2) + 1;
  const num = r.player === 'w' ? `${mn}.` : `${mn}...`;
  const sanFmt = (r.san || '').padEnd(5);
  const v = String(r.verdict).padEnd(12);
  const cpl = r.loss == null ? '  - ' : String(r.loss).padStart(3);
  const wpd = r.wpd == null ? '  -  ' : String(r.wpd.toFixed(1)).padStart(4);
  const sw = r.swing == null ? ' -' : String(r.swing).padStart(2);
  const b = r.best == null ? '   -' : String(r.best).padStart(4);
  const pl = r.played == null ? '   -' : String(r.played).padStart(4);
  const bu = r.bestUci == null ? ' - ' : r.bestUci;
  const depth = String(r.depth).padStart(2);
  const tt = String(r.ttMs).padStart(4);
  const bl = r.bookLine ? `   ${r.bookLine}` : '';
  console.log(`${String(r.ply + 1).padStart(2)}  ${num.padEnd(5)}${sanFmt} ${v}  ${cpl}  ${wpd}  ${sw}  ${b}  ${pl}  ${String(bu).padEnd(7)}  ${depth}  ${tt}ms ${bl}`);
});

const per = { w: Object.fromEntries([...REVIEW_ORDER].map((v) => [v, 0])), b: Object.fromEntries([...REVIEW_ORDER].map((v) => [v, 0])) };
for (const r of results) per[r.player][r.verdict]++;
console.log('\nWhite (29 plies):   ' + Object.entries(per.w).map(([k, n]) => `${LABEL[k] || k}=${n}`).join('  '));
console.log('Black (28 plies):   ' + Object.entries(per.b).map(([k, n]) => `${LABEL[k] || k}=${n}`).join('  '));

const wBoth = Object.entries(per.w).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${LABEL[k] || k} ${n}`);
const bBoth = Object.entries(per.b).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${LABEL[k] || k} ${n}`);
console.log('\nWhite:  ' + wBoth.join(', '));
console.log('Black:  ' + bBoth.join(', '));

sf.proc.kill();