/* Copies the Stockfish 18 engines from node_modules into public/, where Vite
   serves them verbatim. Each single-file build locates its .wasm next to
   itself using its OWN basename, so matching names are required:

     stockfish.js / stockfish.wasm        — FULL NNUE build (large net, strong)
                                             used by GAME REVIEW (parity with
                                             Chess.com's classification needs the
                                             big network weights).
     stockfish-lite.js / stockfish-lite.wasm — LITE build (small net, ~7 MB, much
                                             faster to load) used by board
                                             ANALYSIS / engine bar / computer
                                             games — a deliberately separate,
                                             lighter engine.

   The two engines share the same wrapper but MUST NOT share a worker pool:
   every pool pins one distinct .wasm file.

   ONE PATCH IS APPLIED ON THE WAY IN (see fixAbortRecursion below): the
   published wrapper turns an aborted .wasm download into an infinite recursion. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The wrapper's progress stream (the one that reports "downloaded X of Y bytes"
   to the worker) pumps itself with `read().then(...).catch(...)`, and its catch
   is a named function expression that calls ITSELF:

     .catch(function e(n){ r.error(n), e(n) })

   So the moment a read rejects — which is what happens when a 113 MB stream is
   cut, by a dropped connection, a phone leaving the page, or our own boot timer
   terminating the worker — the catch re-enters synchronously, rejects again, and
   runs until the stack is gone:

     Uncaught (in promise) RangeError: Maximum call stack size exceeded

   The stream is already erroring after `r.error(n)`, so the self-call adds
   nothing but the crash; it also buries the real message ("WASM streaming
   failed") under a wall of stack overflows. Dropping the self-call leaves the
   upstream behaviour intact and lets the rejection surface once, where the pool
   can report it. */
const ABORT_RECURSION = '.catch(function e(n){r.error(n),e(n)})';
const ABORT_FIX = '.catch(function e(n){r.error(n)})';

function fixAbortRecursion(file) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(ABORT_FIX)) return `${file}: already patched`;
  if (!src.includes(ABORT_RECURSION)) return `${file}: no progress stream to patch`;
  writeFileSync(file, src.replace(ABORT_RECURSION, ABORT_FIX));
  return `${file}: abort recursion removed`;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const dstDir = join(root, 'public');

mkdirSync(dstDir, { recursive: true });
const full = join(dstDir, 'stockfish.js');
const lite = join(dstDir, 'stockfish-lite.js');
copyFileSync(join(srcDir, 'stockfish-18-single.js'), full);
copyFileSync(join(srcDir, 'stockfish-18-single.wasm'), join(dstDir, 'stockfish.wasm'));
copyFileSync(join(srcDir, 'stockfish-18-lite-single.js'), lite);
copyFileSync(join(srcDir, 'stockfish-18-lite-single.wasm'), join(dstDir, 'stockfish-lite.wasm'));
console.log(fixAbortRecursion(full));
console.log(fixAbortRecursion(lite));
console.log('Stockfish 18 full NNUE (review) + lite (analysis) engines copied to public/');