/* Minimal UCI client for Stockfish, used by the puzzle generator.
 *
 * Engine resolution order:
 *   1. STOCKFISH_PATH — a native binary (spawned directly) or a .js/.cjs/.mjs
 *      build (spawned under `process.execPath`).
 *   2. The bundled frontend/public/stockfish.js + stockfish.wasm pair (local
 *      development on this repo; staged into tmpdir once so the .wasm resolves
 *      beside its script).
 *
 * Every search is depth-limited with a wall-clock timeout, so one pathological
 * position can never wedge a generation job.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FRONTEND_PUBLIC = path.join(REPO_ROOT, 'frontend', 'public');
const MATE_CP = 10000;

class EngineUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ENGINE_UNAVAILABLE';
  }
}

function stageBundledEngine() {
  const js = path.join(FRONTEND_PUBLIC, 'stockfish.js');
  const wasm = path.join(FRONTEND_PUBLIC, 'stockfish.wasm');
  if (!fs.existsSync(js) || !fs.existsSync(wasm)) return null;
  const dir = path.join(os.tmpdir(), 'matezone-puzzle-sf');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'stockfish.cjs');
  const wasmDest = path.join(dir, 'stockfish.wasm');
  if (!fs.existsSync(dest)) fs.copyFileSync(js, dest);
  if (!fs.existsSync(wasmDest)) fs.copyFileSync(wasm, wasmDest);
  return dest;
}

function resolveEngine() {
  const configured = String(process.env.STOCKFISH_PATH || '').trim();
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new EngineUnavailableError(
        `STOCKFISH_PATH points at "${configured}", but no file exists there.`
      );
    }
    if (/\.(c|m)?js$/i.test(configured)) return { cmd: process.execPath, args: [configured] };
    return { cmd: configured, args: [] };
  }
  const staged = stageBundledEngine();
  if (staged) return { cmd: process.execPath, args: [staged] };
  throw new EngineUnavailableError(
    'Stockfish not found. Set STOCKFISH_PATH to a Stockfish binary (or a stockfish.js build).'
  );
}

/** "score cp 34" / "score mate 3" → centipawns from the side to move. */
function scoreToCp(kind, value) {
  if (kind === 'mate') {
    const n = Number(value);
    return n >= 0 ? MATE_CP - n * 10 : -MATE_CP + Math.abs(n) * 10;
  }
  return Number(value) || 0;
}

class Engine {
  constructor(proc, { hashMb = 128, threads = 1 } = {}) {
    this.proc = proc;
    this.buf = '';
    this.waiters = [];
    this.searchWaiters = [];
    this.chain = Promise.resolve();
    this.dead = false;
    this.lines = [];
    this.depthSeen = 0;

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.on('exit', () => { this.dead = true; this._failAll(new Error('Stockfish exited')); });
    proc.stderr.on('data', () => {});

    this.hashMb = hashMb;
    this.threads = threads;
  }

  _write(cmd) {
    if (this.dead) return;
    try { this.proc.stdin.write(`${cmd}\n`); } catch { /* engine already gone */ }
  }

  _onData(chunk) {
    this.buf += chunk;
    const parts = this.buf.split('\n');
    this.buf = parts.pop();
    for (const line of parts) {
      if (!line) continue;
      if (line.startsWith('info ') && line.includes(' multipv ')) {
        this._collectInfo(line);
      } else if (line.startsWith('bestmove')) {
        this._finishSearch(line);
      }
      for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
        if (this.waiters[i].test(line)) {
          const w = this.waiters.splice(i, 1)[0];
          w.resolve(line);
        }
      }
    }
  }

  _collectInfo(line) {
    const depth = Number((line.match(/ depth (\d+)/) || [])[1] || 0);
    const multipv = Number((line.match(/ multipv (\d+)/) || [])[1] || 1);
    if (depth < this.depthSeen) return;         // only keep the deepest report per line
    const scoreMatch = line.match(/ score (cp|mate) (-?\d+)/);
    const pv = line.split(' pv ')[1];
    if (!scoreMatch || !pv) return;
    const uci = pv.trim().split(/\s+/)[0];
    const entry = {
      multipv,
      depth,
      uci,
      cp: scoreToCp(scoreMatch[1], scoreMatch[2]),
      mate: scoreMatch[1] === 'mate' ? Number(scoreMatch[2]) : null,
      pv: pv.trim().split(/\s+/),
    };
    const idx = this.lines.findIndex((l) => l.multipv === multipv);
    if (idx >= 0) this.lines[idx] = entry;
    else this.lines.push(entry);
    this.depthSeen = depth;
  }

  _finishSearch(line) {
    const w = this.searchWaiters.shift();
    if (!w) return;
    clearTimeout(w.timer);
    const best = (line.match(/bestmove (\S+)/) || [])[1] || null;
    w.resolve({ bestmove: best, lines: this.lines.slice().sort((a, b) => a.multipv - b.multipv) });
  }

  _failAll(err) {
    for (const w of this.waiters.splice(0)) w.reject(err);
    for (const w of this.searchWaiters.splice(0)) { clearTimeout(w.timer); w.reject(err); }
  }

  _waitFor(test, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Stockfish handshake timed out')), timeoutMs);
      this.waiters.push({ test, resolve: (l) => { clearTimeout(timer); resolve(l); }, reject });
    });
  }

  async boot() {
    if (this.booted) return;
    this.booted = true;
    this._write('uci');
    await this._waitFor((l) => l.startsWith('uciok'), 30000);
    this._write(`setoption name Threads value ${this.threads}`);
    this._write(`setoption name Hash value ${this.hashMb}`);
    this._write('setoption name UCI_LimitStrength value false');
    this._write('isready');
    await this._waitFor((l) => l.startsWith('readyok'), 30000);
  }

  /** Serialized because Stockfish answers one search at a time. */
  search(fen, { depth = 18, multiPv = 2, timeoutMs = 20000 } = {}) {
    const run = async () => {
      await this.boot();
      if (this.dead) throw new Error('Stockfish is not running');
      this.lines = [];
      this.depthSeen = 0;
      this._write('ucinewgame');
      this._write(`setoption name MultiPV value ${multiPv}`);
      this._write(`position fen ${fen}`);
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._write('stop');
          reject(new Error('Stockfish search timed out'));
        }, timeoutMs);
        this.searchWaiters.push({ resolve, reject, timer });
      });
      this._write(`go depth ${depth}`);
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  quit() {
    if (this.dead) return;
    this.dead = true;
    try { this._write('quit'); } catch { /* ignore */ }
    setTimeout(() => { try { this.proc.kill(); } catch { /* ignore */ } }, 300);
  }
}

/** Start one engine and wait for it to answer `uci`+`isready`. */
async function createEngine(options = {}) {
  const { cmd, args } = resolveEngine();
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const engine = new Engine(proc, options);
  const spawnError = new Promise((_, reject) => {
    proc.once('error', (err) => {
      reject(new EngineUnavailableError(`Could not start Stockfish (${cmd}): ${err.message}`));
    });
  });
  await Promise.race([engine.boot(), spawnError]);
  return engine;
}

/**
 * A small fixed-size pool. Searches are handed to the next free engine, which
 * caps Stockfish concurrency without any scheduler in the job layer.
 */
function createEnginePool(size = 2, options = {}) {
  let engines = null;
  const idle = [];
  const waiting = [];

  async function ensure() {
    if (engines) return;
    engines = [];
    for (let i = 0; i < size; i += 1) {
      try {
        engines.push(await createEngine(options));
      } catch (err) {
        // One engine is enough to make progress; only fail when none start.
        if (!engines.length) throw err;
      }
    }
    engines.forEach((e) => idle.push(e));
  }

  async function acquire() {
    await ensure();
    if (idle.length) return idle.pop();
    return new Promise((resolve) => waiting.push(resolve));
  }

  function release(engine) {
    const next = waiting.shift();
    if (next) next(engine);
    else idle.push(engine);
  }

  async function search(fen, opts) {
    const engine = await acquire();
    try {
      return await engine.search(fen, opts);
    } finally {
      release(engine);
    }
  }

  function quit() {
    (engines || []).forEach((e) => e.quit());
    engines = null;
    idle.length = 0;
    waiting.length = 0;
  }

  return { search, quit };
}

module.exports = {
  createEngine,
  createEnginePool,
  EngineUnavailableError,
  MATE_CP,
  scoreToCp,
};
