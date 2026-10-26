/* Game Review's engine pool — the FULL NNUE Stockfish build.

   This is a separate worker pool from ./stockfish.js (the analysis pool).
   Review keeps the big-network NNUE build so its classifications match
   Chess.com; board analysis never pays for that 113 MB download because it
   uses the dedicated lite engine instead. See ./engineConfig.js + the pool
   factory in ./stockfish.js.
*/

import { createPool } from './stockfish.js';
import { REVIEW_ENGINE_POOL, REVIEW_ENGINE_HASH_MB, REVIEW_ENGINE_THREADS, REVIEW_ENGINE_URL } from './engineConfig.js';

const reviewPool = createPool({
  poolSize: REVIEW_ENGINE_POOL,
  workerUrl: REVIEW_ENGINE_URL,
  name: 'review-nnue',
  hashMb: REVIEW_ENGINE_HASH_MB,
  threads: REVIEW_ENGINE_THREADS,
});

export const search = (fen, opts) => reviewPool.search(fen, opts);
export const abortAll = () => reviewPool.abortAll();
export const terminate = () => reviewPool.terminate();
export const engineStatus = () => reviewPool.status();
export const resetPool = () => reviewPool.reset();
/* Boot the NNUE worker pool in the background (download + compile the WASM)
   so the first "Advanced Engine / Review" click answers without a stall. */
export const warmEngine = () => reviewPool.ready();