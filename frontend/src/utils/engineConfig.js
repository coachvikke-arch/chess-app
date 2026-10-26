/* Engine selection config — which Stockfish WASM build powers which feature.

   Two DISTINCT physical engines are deployed to public/ (see
   scripts/copy-stockfish.mjs):

     REVIEW_ENGINE_URL  → stockfish.js       = FULL NNUE build (large net
                                               nn-c288c895ea92 + compact net,
                                               ~113 MB). Used ONLY by the Game
                                               Review pipeline so verdicts stay
                                               aligned with Chess.com's NNUE
                                               evaluation.
     ANALYSIS_ENGINE_URL → stockfish-lite.js = LITE build (small net
                                               nn-9067e33176e8, ~7 MB, loads in
                                               a blink). Used by live board
                                               analysis, the engine bar, and
                                               computer games — a separate,
                                               lighter engine that keeps the
                                               heavy network confined to review.

   Pool size changes throughput only — every worker pins Threads=1 / Hash /
   Ponder=false and fixed-depth searches are identical wherever they run, so
   run-to-run determinism is preserved.

   NOTE: Stockfish 18 no longer exposes the "Use NNUE" UCI toggle, so the two
   modes genuinely need two builds (kept in one npm `stockfish` package).
*/

import { REVIEW_WORKER_POOL, REVIEW_HASH_MB, REVIEW_THREADS, REVIEW_POOL_MAX } from './reviewConfig.js';

/* public/ is the Vite static root; BASE_URL covers sub-path deployments. */
export const BASE_URL = import.meta.env?.BASE_URL ?? '';

/* Review pool size auto-scales to spare cores (cores − 1), capped at
   REVIEW_POOL_MAX; Node/tests have no navigator and keep REVIEW_WORKER_POOL
   so harness expectations stay meaningful. Pool size changes ONLY throughput —
   every worker pins Threads=1 / Hash / Ponder=false and fixed-depth searches
   are identical wherever they run (see the determinism notes above).

   The FULL review network is ≈113 MB of WASM per worker plus a 128MB hash
   table, so the pool is also clamped by the device's reported memory: ≤4 GB
   machines (many phones / low-RAM laptops) get at most 2 workers — a third
   concurrent 113 MB download + instance is exactly where "Stockfish WebAssembly
   failed to load or boot" comes from on constrained hardware. */
function detectReviewPoolSize() {
  const hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
  if (!hw) return REVIEW_WORKER_POOL;
  let pool = Math.max(1, Math.min(Math.max(2, hw - 1), REVIEW_POOL_MAX));
  const mem = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8;
  if (mem <= 4) pool = Math.min(pool, 2);
  return pool;
}

export const REVIEW_ENGINE_URL = 'stockfish.js';
export const ANALYSIS_ENGINE_URL = 'stockfish-lite.js';

/* review loves parallelism (57-plies run ~3x faster with 3 workers);
   analysis is a single live search at a time → one worker is plenty.
   Each review worker gets a 128MB hash (chess.com-grade); the SF.js WASM build
   is single-threaded per instance, so REVIEW_THREADS stays 1 and the pool is
   the concurrency knob — every worker still searches byte-for-byte identically
   (fixed depth + fixed options = reproducible runs). */
export const REVIEW_ENGINE_POOL = detectReviewPoolSize();

/* Dispatch width (plies in flight) = the pool width, unless overridden.
   `?dispatchWidth=N` on the URL forces a width for A/B measurement
   (scripts/review-dispatch-ab.mjs drives this); it changes throughput only.
   The override is clamped: width only sizes the request queue, so an unbounded
   value is pure memory pressure with no possible benefit. */
const DISPATCH_WIDTH_MIN = 1;
const DISPATCH_WIDTH_MAX = 64;
function detectDispatchWidth(pool) {
  if (typeof window !== 'undefined' && window.location) {
    const q = new URLSearchParams(window.location.search).get('dispatchWidth');
    const n = Number(q);
    if (Number.isFinite(n)) {
      return Math.min(DISPATCH_WIDTH_MAX, Math.max(DISPATCH_WIDTH_MIN, Math.round(n)));
    }
  }
  return Math.min(DISPATCH_WIDTH_MAX, Math.max(DISPATCH_WIDTH_MIN, pool * 4));
}

/* How many PLIES the review pipeline keeps in flight at once.
   This is deliberately larger than the worker pool. One ply needs 1-3 engine
   searches (top-moves, a played-move fallback eval, a Brilliant settle) that
   must run SEQUENTIALLY for that ply but are independent of every other ply.
   With the dispatch width pinned to the pool size, a ply sitting on its 2nd
   search still occupies one of the N "slots", so the remaining workers can
   starve — the pool's own queue is where the work should wait instead.

   Queuing more requests does NOT run more searches at once (the pool still
   executes exactly N concurrently) and does NOT change any result: every
   search is keyed by its own position, each worker clears its TT before
   searching and has Threads/Hash/Ponder pinned, so a position's verdict is
   independent of which worker runs it and of when. The extra entries are
   tiny request objects, not extra engines or extra memory. */
export const REVIEW_DISPATCH_WIDTH = detectDispatchWidth(REVIEW_ENGINE_POOL);
export const REVIEW_ENGINE_HASH_MB = REVIEW_HASH_MB;
export const REVIEW_ENGINE_THREADS = REVIEW_THREADS;
export const ANALYSIS_ENGINE_POOL = 1;