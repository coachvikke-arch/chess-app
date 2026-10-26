/* Stockfish 18 (bundled SF.js WASM, Node UCI mode) exposed with the SAME
   interface the in-browser review pipeline expects — a drop-in `engine`
   replacement for reviewGame when running under Node:
     searchTopMoves(fen, { maxDepth, multiPv })
       → [{ rank, uci, san, score (WHITE-persp cp), mate, depth, pv }]
     evaluateGame(fen, { maxDepth })
       → { score (WHITE-persp cp), mate, depth }
   One subprocess per engine instance, commands serialized through a promise
   queue (Stockfish is single-threaded). Used by scripts/compare-chesscom.mjs
   so the chess.com-copy validation runs the EXACT real engine, not a mock.

   Node:  node scripts/nodeEngine.mjs  (self-test; run from frontend/)
*/

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Chess } from 'chess.js';
import { scoreFields } from '../src/utils/engineScore.js';
import { REVIEW_HASH_MB } from '../src/utils/reviewConfig.js';
import { REVIEW_ENGINE_POOL } from '../src/utils/engineConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const PER_SEARCH_TIMEOUT_MS = 130000;

/* Stage a CommonJS copy of the engine + wasm in the temp dir (frontend is
   "type": "module", so a .cjs copy runs in the engine's native Node UCI mode
   and resolves stockfish.wasm relative to its own dir). */
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

export async function createReviewEngine({ hashMb = REVIEW_HASH_MB, threads = 1, clearHash = true } = {}) {
  const proc = spawn(process.execPath, [ensureEngineCopy()], { stdio: ['pipe', 'pipe', 'inherit'] });
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
        if (waiters[i].starts(line)) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(line);
        }
      }
    }
  });
  let booted = false;
  let chain = Promise.resolve();

  async function boot() {
    if (booted) return;
    booted = true;
    await raw('uci');
    await waitForLine((l) => l.startsWith('uciok'), 20000);
    raw(`setoption name Threads value ${threads}`);
    raw(`setoption name Hash value ${hashMb}`);
    raw('setoption name Ponder value false');
    raw('setoption name UCI_LimitStrength value false');
    raw('setoption name Skill Level value 20');
    await raw('isready');
    await waitForLine((l) => l.startsWith('readyok'), 20000);
  }

  function raw(cmd) {
    proc.stdin.write(cmd + '\n');
  }

  function waitForLine(starts, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.starts === starts);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`timeout waiting for engine response: ${starts}`));
      }, timeoutMs);
      waiters.push({ starts, resolve: (line) => { clearTimeout(timer); resolve(line); } });
    });
  }

  /* One fixed-depth search → ranks exactly like stockfish.js returns.
     `score` is WHITE-perspective centipawns (or mate sentinel), `depth` the
     search depth of that rank (partial depths land on 0 — the pipeline's trust
     floor uses the MAX seen depth). */
  async function runSearch(fen, { maxDepth, multiPv }) {
    await boot();
    if (clearHash) raw('setoption name Clear Hash value true');
    raw(`setoption name MultiPV value ${multiPv}`);
    raw(`position fen ${fen}`);
    raw(`go depth ${maxDepth}`);
    const ranks = {};
    let bestmoveLine;
    try {
      bestmoveLine = await waitForLine((line) => {
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
            if (cp != null) { entry.cp = cp; entry.mate = null; }
            if (mate != null) { entry.mate = mate; entry.cp = null; }
            if (pv) entry.pv = pv;
          }
          ranks[rank] = entry;
        }
        return line.startsWith('bestmove');
      }, PER_SEARCH_TIMEOUT_MS);
    } catch (err) {
      raw('stop');
      await waitForLine((l) => l.startsWith('bestmove'), 8000).catch(() => {});
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
        const sign = stm === 'w' ? 1 : -1;
        const fields = scoreFields(entry.mate != null
          ? { type: 'mate', value: sign * entry.mate, winner: sign * (entry.mate > 0 ? 1 : -1) }
          : { type: 'cp', value: sign * (entry.cp ?? 0) });
        return { rank, uci, ...fields, depth: entry.depth, pv: entry.pv };
      })
      .filter(Boolean);
    return { moves: movelist, bestmove: bm };
  }

  /* Serialized searchTopMoves: worker pool is handled at the pool level in the
     browser; here ONE SF instance serves requests strictly one at a time
     (Stockfish's command interface is single-threaded — issuing a second
     `go` while the first is running desyncs the protocol and can crash the
     wasm). Requests chain off a mutable promise so reviewGame's concurrent
     window parallelism degrades gracefully to a sequence. */
  function searchTopMoves(fen, { maxDepth, multiPv } = {}) {
    const run = chain.then(() => runSearch(fen, { maxDepth, multiPv }));
    chain = run.then(
      () => {},
      () => {},
    ); // keep the chain alive even when one search fails
    return run.then((r) => r.moves);
  }

  function evaluateGame(fen, { maxDepth } = {}) {
    const g = new Chess(fen);
    if (g.isCheckmate()) return Promise.resolve({ ...scoreFields({ type: 'mate', value: 0, winner: g.turn() === 'w' ? -1 : 1 }), depth: maxDepth });
    if (g.isGameOver()) return Promise.resolve({ ...scoreFields(0), depth: maxDepth });
    return searchTopMoves(fen, { maxDepth, multiPv: 1 }).then((moves) => {
      const best = moves[0];
      return best
        ? { ...scoreFields(best), depth: best.depth || 0 }
        : { score: null, mate: null, depth: 0 };
    });
  }

  return {
    searchTopMoves,
    evaluateGame,
    destroy() {
      try { proc.kill(); } catch { /* already dead */ }
    },
  };
}

/* Engine POOL for Node — mirrors the browser's nnue.js worker pool. Each search
   clears the TT and runs to the requested depth, so dispatching searches across
   N SF processes yields byte-for-byte the same verdicts as one process but ~N×
   shorter wall-clock. Requests go to the currently least-busy worker. */
export async function createReviewEnginePool({ size = REVIEW_ENGINE_POOL, hashMb } = {}) {
  const engines = [];
  for (let i = 0; i < size; i++) engines.push(await createReviewEngine({ hashMb }));
  const pending = new Array(size).fill(0);
  const leastBusy = () => {
    let best = 0;
    for (let i = 1; i < size; i++) if (pending[i] < pending[best]) best = i;
    return best;
  };
  const dispatch = (fn) => {
    const i = leastBusy();
    pending[i]++;
    return fn(engines[i]).finally(() => { pending[i]--; });
  };
  return {
    searchTopMoves: (fen, opts) => dispatch((e) => e.searchTopMoves(fen, opts)),
    evaluateGame: (fen, opts) => dispatch((e) => e.evaluateGame(fen, opts)),
    async destroy() { engines.forEach((e) => e.destroy()); },
  };
}

/* ── self-test ── */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const eng = await createReviewEngine({ hashMb: 16 });
  const g = new Chess('rnbqkbnr/pppp1ppp/8/8/4p3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4');
  const tops = await eng.searchTopMoves(g.fen(), { maxDepth: 10, multiPv: 2 });
  console.log('top moves (white-persp):');
  for (const t of tops) {
    const tg = new Chess(g.fen());
    const san = tg.move({ from: t.uci.slice(0, 2), to: t.uci.slice(2, 4), promotion: t.uci.length > 4 ? t.uci[4] : undefined })?.san;
    console.log(`  ${t.rank}. ${san} (${t.uci})  ${t.score}cp  depth ${t.depth}`);
  }
  const ev = await eng.evaluateGame(g.fen(), { maxDepth: 10 });
  console.log(`evaluateGame → ${ev.score}cp @ depth ${ev.depth}${ev.mate != null ? ` (mate ${ev.mate})` : ''}`);
  eng.destroy();
}