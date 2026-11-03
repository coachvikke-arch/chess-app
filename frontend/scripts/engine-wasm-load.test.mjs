// Regression tests for how the Stockfish engines LOAD (not how they search):
//   1. src/utils/stockfish.js — a pool boots its workers ONE AT A TIME.
//   2. scripts/copy-stockfish.mjs + public/stockfish*.js — the vendored wrapper
//      no longer turns an aborted .wasm stream into an infinite recursion.
//
// Both defects showed up together on the deployed analysis page. The review
// pool boots up to four workers, and every one of them pulls a 113 MB .wasm;
// four concurrent pulls is what aborts mid-stream on a phone. The abort then
// hit the wrapper's own bug — a `.catch` that called itself — so a single
// dropped connection became a wall of "Maximum call stack size exceeded" and
// "WASM streaming failed" lines, with the real error buried under them.
//
// Same harness as engine-pool.test.mjs: createPool() reaches `Worker` through
// the global scope, so a fake Worker drives the boot sequence headlessly — no
// browser, no WASM, no 150s wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const POOL_SRC = new URL('../src/utils/stockfish.js', import.meta.url);
const COPY_SRC = new URL('../scripts/copy-stockfish.mjs', import.meta.url);
const FULL_WRAPPER = new URL('../public/stockfish.js', import.meta.url);
const LITE_WRAPPER = new URL('../public/stockfish-lite.js', import.meta.url);

/* The upstream bug, verbatim from node_modules/stockfish/bin/stockfish-18-*.js,
   and the one-token fix copy-stockfish.mjs writes over it. */
const RECURSION = '.catch(function e(n){r.error(n),e(n)})';
const FIXED = '.catch(function e(n){r.error(n)})';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Import createPool with its engineConfig import dropped (that module reads
 *  import.meta.env, which is Vite-only). engineScore.js has no dependencies of
 *  its own, so it is copied next to the pool untouched — the boot path uses it
 *  exactly as the app does. */
async function loadPool() {
  const dir = mkdtempSync(join(tmpdir(), 'wasmload-'));
  copyFileSync(fileURLToPath(new URL('../src/utils/engineScore.js', import.meta.url)),
    join(dir, 'engineScore.js'));
  let source = readFileSync(POOL_SRC, 'utf8');
  source = source.replace(
    /^import\s+\{[^}]*\}\s+from\s+['"]\.\/engineConfig\.js['"];?[ \t]*\r?\n/m,
    'const BASE_URL = "", ANALYSIS_ENGINE_POOL = 1, ANALYSIS_ENGINE_URL = "sf.js";',
  );
  const { code } = await transform(source, { loader: 'js', format: 'esm' });
  const file = join(dir, 'pool.mjs');
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

/** A worker that answers the UCI handshake only when the test tells it to, so
 *  the ORDER of worker creation is observable. */
class FakeWorker {
  static instances = [];
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.sent = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  postMessage(cmd) { this.sent.push(cmd); }
  /** Exactly what a healthy worker does when it is handed `uci`. */
  handshake() {
    queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
    queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;

const { createPool } = await loadPool();
const reviewPool = (poolSize) =>
  createPool({ poolSize, workerUrl: 'sf.js', name: 'review', hashMb: 128, threads: 1 });

test('a multi-slot pool creates only ONE worker until it answers', async () => {
  FakeWorker.instances = [];
  const pool = reviewPool(3);
  const boot = pool.ready();
  await tick();

  assert.equal(FakeWorker.instances.length, 1,
    'four workers used to start four simultaneous 113 MB downloads; boot is series now');
  const r = await Promise.race([
    boot.then(() => 'resolved'),
    tick().then(() => 'pending'),
  ]);
  assert.equal(r, 'pending', 'the boot must still be waiting on the first worker');
  pool.terminate();
});

test('each worker unlocks the next, and all of them pin the same options', async () => {
  FakeWorker.instances = [];
  const pool = reviewPool(3);
  const boot = pool.ready();

  for (let i = 0; i < 3; i++) {
    await tick();
    assert.equal(FakeWorker.instances.length, i + 1, `worker ${i + 1} must exist when it is its turn`);
    FakeWorker.instances[i].handshake();
  }
  await boot;
  assert.equal(FakeWorker.instances.length, 3, 'the whole pool ends up booted');
  assert.equal(pool.status().state, 'ready');
  assert.equal(pool.status().readySlots, 3);
  for (const w of FakeWorker.instances) {
    assert.ok(w.sent.includes('setoption name Threads value 1'), 'threads pinned per worker');
    assert.ok(w.sent.includes('setoption name Hash value 128'), 'hash pinned per worker');
    assert.ok(w.sent.includes('setoption name Ponder value false'), 'ponder off per worker');
  }
  pool.terminate();
});

test('a first worker that fails to start does not drag three more downloads after it', async () => {
  FakeWorker.instances = [];
  const pool = reviewPool(3);
  const boot = pool.ready();
  await tick();
  FakeWorker.instances[0].onerror({ message: 'boom' });

  const r = await Promise.race([
    boot.then(() => 'resolved', () => 'rejected'),
    tick().then(() => 'pending'),
  ]);
  assert.equal(r, 'rejected', 'the boot must settle on the failure');
  await tick();
  assert.equal(FakeWorker.instances.length, 1, 'no further downloads are launched');
  assert.equal(pool.status().state, 'failed');
});

test('terminate() mid-sequence stops the remaining workers from launching', async () => {
  FakeWorker.instances = [];
  const pool = reviewPool(3);
  const boot = pool.ready();
  await tick();
  FakeWorker.instances[0].handshake();
  await tick();                        // worker 2 is now up and booting
  assert.equal(FakeWorker.instances.length, 2);

  pool.terminate();
  await boot.then(() => 'resolved', () => 'rejected');
  await tick();
  FakeWorker.instances[1].handshake(); // a late answer must not open slot 3
  await tick();
  assert.equal(FakeWorker.instances.length, 2, 'a torn-down pool launches nothing more');
});

/* ── the vendored wrapper ─────────────────────────────────────────────────── */

test('the copied wrappers have no self-calling stream catch', () => {
  const copyScript = readFileSync(COPY_SRC, 'utf8');
  assert.ok(copyScript.includes(RECURSION),
    'copy-stockfish.mjs must name the exact upstream pattern it patches');
  assert.match(copyScript, /writeFileSync\(file, src\.replace\(ABORT_RECURSION, ABORT_FIX\)\)/,
    'and replace it with the non-recursive form');
  assert.match(copyScript, /fixAbortRecursion\(full\)[\s\S]*fixAbortRecursion\(lite\)/,
    'both engine wrappers are patched, not just the review one');

  /* The files actually shipped: a fresh checkout gets them from postinstall, an
     existing tree has them committed, so either way this is what loads. */
  for (const url of [FULL_WRAPPER, LITE_WRAPPER]) {
    if (!existsSync(fileURLToPath(url))) continue; // wasm-only checkout
    const src = readFileSync(url, 'utf8');
    assert.ok(!src.includes(RECURSION), `${url}: recursion still present`);
    assert.ok(src.includes(FIXED), `${url}: catch was not rewritten`);
  }
});

test('the service worker still refuses to cache the engines', () => {
  /* The fix depends on the browser's own HTTP cache, not the Cache API: the
     worker must keep passing /stockfish straight to the network. */
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/stockfish'\)/);
  assert.match(sw, /if \(isApiPath\(url\) \|\| isEnginePath\(url\)\) return;/);
});
