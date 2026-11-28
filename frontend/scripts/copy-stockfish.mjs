/* Copies the Stockfish 19 engines from node_modules into public/, where Vite
   serves them verbatim. Each single-file build locates its .wasm next to
   itself using its OWN basename, so matching names are required:

     stockfish.js / stockfish.wasm        — FULL NNUE build (large net, strong)
                                             used by GAME REVIEW (parity with
                                             Chess.com's classification needs the
                                             big network weights).
     stockfish-lite.js / stockfish-lite.wasm — LITE build (small net, much
                                             faster to load) used by board
                                             ANALYSIS / engine bar / computer
                                             games — a deliberately separate,
                                             lighter engine.

   The two engines share the same wrapper but MUST NOT share a worker pool:
   every pool pins one distinct .wasm file.

   TWO PATCHES ARE APPLIED ON THE WAY IN (see below): the
   published wrapper turns an aborted .wasm download into an infinite recursion,
   and its remote-download path uses streaming WASM compilation, which rejects
   the raw GitHub URL's MIME type.

   SKIP_FULL_WASM=1 leaves the 94 MB full network OUT of public/ so a Cloudflare
   Pages build fits under its 25 MiB per-asset limit. Set VITE_REVIEW_WASM_URL
   to a CORS-enabled URL for that file in the same build. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The wrapper's progress stream (the one that reports "downloaded X of Y bytes"
   to the worker) pumps itself with `read().then(...).catch(...)`, and its catch
   is a named function expression that calls ITSELF:

     .catch(function e(n){ r.error(n), e(n) })        // SF 18
     .catch(function t(r){ e.error(r), t(r) })        // SF 19

   So the moment a read rejects — which is what happens when a 99 MB stream is
   cut, by a dropped connection, a phone leaving the page, or our own boot timer
   terminating the worker — the catch re-enters synchronously, rejects again, and
   runs until the stack is gone:

     Uncaught (in promise) RangeError: Maximum call stack size exceeded

   The stream is already erroring after `x.error(y)`, so the self-call adds
   nothing but the crash; it also buries the real message ("WASM streaming
   failed") under a wall of stack overflows. Dropping the self-call leaves the
   upstream behaviour intact and lets the rejection surface once, where the pool
   can report it. Matched by shape rather than by literal text so an upstream
   rename of the minified identifiers cannot quietly skip the patch. */
const ABORT_RECURSION = /\.catch\(function (\w+)\((\w+)\)\{(\w+)\.error\(\2\),\1\(\2\)\}\)/;

/* The FULL review engine's remote-WASM path re-streams the GitHub download
 * through a new Response and compiles it with WebAssembly.instantiateStreaming.
 * raw.githubusercontent.com serves .wasm as `application/octet-stream`, so the
 * browser rejects it with "Incorrect response MIME type. Expected
 * 'application/wasm'" — the worker never reaches `uciok` and the review card
 * sits at "Analyzing… 0%" forever. Emscripten's own loader has an ArrayBuffer
 * fallback, but THIS progress-reporting path does not (it rethrows). Compile
 * the same bytes from an ArrayBuffer: a slightly slower cold boot, identical
 * engine results, and no extra hosting service. */
const REMOTE_STREAM_COMPILE = '.then(function(t){return WebAssembly.instantiateStreaming(t,e)}).then(function(e){return r(e.instance,e.module),e.instance.exports})';
const REMOTE_BUFFER_COMPILE = '.then(function(t){return t.arrayBuffer()}).then(function(t){return WebAssembly.instantiate(t,e)}).then(function(e){return r(e.instance,e.module),e.instance.exports})';

function fixRemoteWasmMime(file) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(REMOTE_STREAM_COMPILE)) return `${file}: no remote streaming compile to patch`;
  writeFileSync(file, src.replace(REMOTE_STREAM_COMPILE, REMOTE_BUFFER_COMPILE));
  return `${file}: remote WASM compiled from ArrayBuffer (MIME-safe)`;
}

function fixAbortRecursion(file) {
  const src = readFileSync(file, 'utf8');
  if (!ABORT_RECURSION.test(src)) return `${file}: no progress stream to patch`;
  writeFileSync(file, src.replace(ABORT_RECURSION, '.catch(function $1($2){$3.error($2)})'));
  return `${file}: abort recursion removed`;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const dstDir = join(root, 'public');

mkdirSync(dstDir, { recursive: true });
const full = join(dstDir, 'stockfish.js');
const lite = join(dstDir, 'stockfish-lite.js');
const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'stockfish', 'package.json'), 'utf8'));
if (pkg.buildVersion !== '19') {
  throw new Error(`copy-stockfish expects the Stockfish 19 package, found ${pkg.version}`);
}
const skipFullWasm = String(process.env.SKIP_FULL_WASM || '').trim() === '1';

copyFileSync(join(srcDir, 'stockfish-19-single.js'), full);
copyFileSync(join(srcDir, 'stockfish-19-lite-single.js'), lite);
copyFileSync(join(srcDir, 'stockfish-19-lite-single.wasm'), join(dstDir, 'stockfish-lite.wasm'));

if (skipFullWasm) {
  const stale = join(dstDir, 'stockfish.wasm');
  if (existsSync(stale)) rmSync(stale);
  console.log('SKIP_FULL_WASM=1: full network not copied. Set VITE_REVIEW_WASM_URL to its remote URL.');
  if (!String(process.env.VITE_REVIEW_WASM_URL || '').trim()) {
    console.warn('WARNING: Game Review will look for /stockfish.wasm, which is not in this build.');
  }
} else {
  copyFileSync(join(srcDir, 'stockfish-19-single.wasm'), join(dstDir, 'stockfish.wasm'));
}

console.log(fixAbortRecursion(full));
console.log(fixAbortRecursion(lite));
/* Only the full build is given a remote WASM URL; the lite build keeps using
   its own same-origin .wasm, which Cloudflare tags application/wasm. */
console.log(fixRemoteWasmMime(full));
console.log('Stockfish 19 workers + lite engine copied to public/');
