// Regression tests for the Stockfish worker pool's TEARDOWN path
// (src/utils/stockfish.js) — run with: node --test (from frontend/)
//
// The review page calls resetReviewEngine() on every "Analyze" click, which
// routes to pool.reset() -> terminate(). Three defects lived on that path and
// all presented as "Review failed" or a review stuck with no progress:
//
//   1. terminate() never cleared `bootTimer`. The orphaned 150s timer fired
//      later and ran failAll(), which terminated the NEWLY booted, healthy
//      workers and marked the pool 'failed' — killing a running review minutes
//      after the click that started it.
//   2. terminate() dropped the in-flight boot promise and every queued/running
//      search WITHOUT settling them, so an awaiting caller waited forever.
//   3. reset() tore down a perfectly 'ready' pool, discarding ~113MB of
//      downloaded+compiled WASM per worker and forcing a cold re-boot.
//
// createPool() takes its worker URL as a parameter and reaches `Worker`
// through the global scope, so a fake Worker on globalThis is enough to drive
// the whole pool headlessly — no browser, no WASM, no 150s wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const POOL_SRC = new URL('../src/utils/stockfish.js', import.meta.url);

/* Any string is a usable FEN for the pool: it never validates, it just echoes
   the FEN back to the worker. */
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Import createPool with the engineConfig import dropped (it reads
 *  import.meta.env, which is Vite-only). */
async function loadPool() {
  let source = readFileSync(POOL_SRC, 'utf8');
  source = source.replace(
    /^import\s+\{[^}]*\}\s+from\s+['"]\.\/engineConfig\.js['"];?[ \t]*\r?\n/m,
    'const BASE_URL = "", ANALYSIS_ENGINE_POOL = 1, ANALYSIS_ENGINE_URL = "sf.js";',
  );
  const { code } = await transform(source, { loader: 'js', format: 'esm' });
  const file = join(mkdtempSync(join(tmpdir(), 'pool-')), 'pool.mjs');
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

/** A fake Stockfish worker. With `handshake` off it never answers `uci`, so a
 *  boot stays in flight; with it on it completes uciok/readyok and answers
 *  `go` with one info line + a bestmove. */
class FakeWorker {
  static instances = [];
  static handshake = true;
  /* When false the worker completes the boot handshake but never answers
     `go` — so a search stays parked in slot.current, which is the state
     terminate() has to clean up. */
  static answerGo = true;
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.sent = [];
    FakeWorker.instances.push(this);
  }
  postMessage(cmd) {
    this.sent.push(cmd);
    if (!FakeWorker.handshake) return;
    if (cmd === 'uci') queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
    if (cmd === 'isready') queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
    if (cmd.startsWith('go ') && FakeWorker.answerGo) {
      queueMicrotask(() => this.onmessage?.({
        data: 'info depth 18 multipv 1 score cp 25 pv e2e4',
      }));
      queueMicrotask(() => this.onmessage?.({ data: 'bestmove e2e4' }));
    }
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;

/** 'pending' if `p` has not settled within `ms` — i.e. the caller hangs. */
const settledWithin = (p, ms) =>
  Promise.race([
    p.then((v) => ({ state: 'resolved', v }), (e) => ({ state: 'rejected', e })),
    new Promise((r) => setTimeout(() => r({ state: 'pending' }), ms)),
  ]);


const { createPool } = await loadPool();
const newPool = (opts = {}) =>
  createPool({ poolSize: 1, workerUrl: 'sf.js', name: 'test', ...opts });

test('terminate() settles an in-flight boot instead of hanging forever', async () => {
  FakeWorker.handshake = false;           // worker never reaches readyok
  try {
    const pool = newPool();
    const boot = pool.ready();
    pool.terminate();                     // a reset lands mid-boot
    const r = await settledWithin(boot, 150);
    assert.equal(r.state, 'rejected', 'boot() must reject on reset, not hang');
    assert.match(r.e.message, /reset/i);
  } finally {
    FakeWorker.handshake = true;
  }
});

test('terminate() settles the running and queued searches instead of hanging', async () => {
  FakeWorker.answerGo = false;            // searches park, never answering
  try {
    const pool = newPool();
    await pool.ready();                   // boot cleanly first
    const running = pool.search(FEN, { depth: 18 });   // occupies slot.current
    const queued = pool.search(FEN, { depth: 18 });    // waits in slot.queue
    await new Promise((r) => setTimeout(r, 20));       // let the first dispatch
    pool.terminate();

    for (const [label, p] of [['running', running], ['queued', queued]]) {
      const r = await settledWithin(p, 150);
      assert.notEqual(r.state, 'pending', `${label} search hung forever after reset`);
      /* resolve(null) — the engine simply had no evaluation. Rejecting here
         would surface to the user as a bogus "Review failed". */
      assert.equal(r.state, 'resolved', `${label} search should resolve, not reject`);
      assert.equal(r.v, null);
    }
  } finally {
    FakeWorker.answerGo = true;
  }
});

test('a reset pool can boot and search again (no poisoned state)', async () => {
  FakeWorker.handshake = false;
  const pool = newPool();
  pool.ready().catch(() => {});           // a boot that will be interrupted
  pool.terminate();
  FakeWorker.handshake = true;

  await pool.ready();                      // must re-boot cleanly
  assert.equal(pool.status().state, 'ready');
  const res = await pool.search(FEN, { depth: 18 });
  assert.ok(res && res.uci, 'search after reset must return a real move');
  assert.equal(res.uci, 'e2e4');
  pool.terminate();
});

test('reset() leaves a healthy ready pool completely alone', async () => {
  const pool = newPool();
  await pool.ready();
  const workerBefore = FakeWorker.instances.at(-1);
  assert.equal(pool.status().state, 'ready');

  pool.reset();                            // what every Analyze click does

  assert.equal(pool.status().state, 'ready', 'a healthy pool must stay ready');
  assert.equal(workerBefore.terminated, false,
    'reset() must not throw away a booted 113MB NNUE worker');
  /* And it must still be usable — the review that follows the click depends on
     this, so a no-op reset must not strand the pool. */
  const res = await pool.search(FEN, { depth: 18 });
  assert.ok(res && res.uci);
  pool.terminate();
});

test('reset() still clears a genuinely failed pool so a retry can boot', async () => {
  FakeWorker.handshake = false;
  const pool = newPool();
  const boot = pool.ready();
  // Simulate the boot failure without waiting out the 150s timeout.
  FakeWorker.instances.at(-1).onerror({ message: 'worker exploded' });
  const r = await settledWithin(boot, 150);
  assert.equal(r.state, 'rejected');
  assert.equal(pool.status().state, 'failed');

  FakeWorker.handshake = true;
  pool.reset();                            // "try again"
  assert.notEqual(pool.status().state, 'failed');
  await pool.ready();
  assert.equal(pool.status().state, 'ready');
  pool.terminate();
});
