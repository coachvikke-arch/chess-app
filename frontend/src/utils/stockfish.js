/* Stockfish (WebAssembly) engine wrapper — worker-pool factory.
   Boots ONE OR MORE Stockfish engines (each a Web Worker) so the UI thread is
   never blocked, and speaks plain UCI with each worker:

     uci / isready / setoption name Skill Level value N / setoption name MultiPV value N
     position fen <fen>
     go depth N [movetime N]

   UCI conventions handled here:
   - "info ... score cp X" is always from the side-to-move's perspective;
     results are converted to white-perspective centipawn scores.
   - "info ... score mate N": N > 0 = the side to move mates in N plies.
   - "info ... multipv N" groups a principal variation; we keep the best line
     per rank so the UI can ask "is my move the only good one?".
   - "bestmove e2e4" is the answer to "go ...".

   TWO POOLS are exported from this family of modules, each pointed at its own
   .wasm build (see ./engineConfig.js):

     stockfish.js  → default export = ANALYSIS pool (lite build, 1 worker):
                     board analysis, engine bar, computer games.
     nnue.js       → GAME REVIEW pool (full NNUE build, REVIEW_ENGINE_POOL
                     workers): ONLY the review pipeline uses this, so the
                     heavy network never chokes live board analysis.

   WORKER POOL: N engines run side by side, each with its own queue. A request
   is dispatched to the least-loaded worker. Every worker is pinned to the same
   options (the pool's fixed threads/hash, Ponder=false) and any given position
   is searched identically wherever it lands — so the pool changes ONLY
   throughput, never a search's result (determinism is preserved). `stop`
   cancels the running search on one worker; the stale "bestmove" is waited for
   before the next request on the SAME worker.
*/

import { BASE_URL, ANALYSIS_ENGINE_POOL, ANALYSIS_ENGINE_URL } from './engineConfig.js';

import { scoreFields } from './engineScore.js';

/* A pool must reach "uciok"+"readyok" on every slot within this window or the
   boot fails loudly (rejects all pending searches) instead of hanging callers
   forever — a worker that never finishes its handshake would otherwise strand
   every pipeline that awaits it. The window is generous because the FULL NNUE
   review build is a ~113 MB .wasm download + compile per worker: on a slow
   first load (mobile data, busy disk) even a single worker needs far more than
   a glance. Warm-up runs on page mount, so steady-state clicks ride an already
   booted pool. */
const BOOT_TIMEOUT_MS = 150000;

/* one pool slot = one Stockfish worker + its own pending queue */
function makeSlots(n) {
  return Array.from({ length: Math.max(1, n || 1) }, () => ({
    worker: null,    // Worker
    current: null,   // active request on this slot
    queue: [],       // pending requests on this slot
    skill: 20,       // last Skill Level sent to this worker
    multiPv: 1,      // last MultiPV value sent to this worker
  }));
}

export function createPool({ poolSize, workerUrl, name = 'stockfish', hashMb = 16, threads = 1 }) {
  const url = `${BASE_URL}${workerUrl}`;
  const slots = makeSlots(poolSize);
  let bootPromise = null;
  let bootReject = null;
  let bootTimer = null;
  let bootFailedAt = 0;
  let lastBootError = '';
  /* Boot attempts so the pool can give up loudly instead of retrying a broken
     worker forever (each failed boot costs a full 150s timeout). Reset on the
     first successful boot. */
  let bootAttempts = 0;
  const BOOT_MAX_ATTEMPTS = 3;

  /* Last-known pool health for the UI: 'idle' | 'booting' | 'ready' | 'failed'.
     Components read this to explain a failure instead of blaming the game. */
  let poolState = 'idle';
  let readySlots = 0;

  function postTo(slot, cmd) {
    if (slot.worker) slot.worker.postMessage(cmd);
  }

  function failAll(err) {
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    bootFailedAt = Date.now();
    poolState = 'failed';
    readySlots = 0;
    lastBootError = err && err.message ? String(err.message) : String(err || 'unknown error');
    /* eslint-disable no-console */
    console.error(`[engine:${name}] boot/search failed:`, lastBootError);
    /* eslint-enable no-console */
    slots.forEach((slot) => {
      if (slot.worker) { try { slot.worker.terminate(); } catch { /* ignore */ } }
      slot.worker = null;
      slot.current = null;
      slot.queue.splice(0).forEach((r) => r.reject(err));
    });
    if (bootReject) { const r = bootReject; bootReject = null; r(err); }
    bootPromise = null;
  }

  function boot() {
    if (bootPromise) return bootPromise;
    if (poolState === 'ready') return Promise.resolve();
    // A failed boot must not be retried-and-rehung 90+ seconds per search while
    // the caller waits: short-circuit for a grace window so downstream pipelines
    // get an immediate, catchable rejection instead of another silent hang.
    // Mirrors BOOT_TIMEOUT_MS so the slow-download case isn't retried instantly.
    if (bootFailedAt && Date.now() - bootFailedAt < 150000) {
      return Promise.reject(new Error(
        `Stockfish engine ${name} is unavailable (previous boot failed${lastBootError ? `: ${lastBootError}` : ''}). ` +
        'Check your connection (the review engine is a ~113 MB download on first use) and reload the page. '
      ));
    }
    if (bootAttempts >= BOOT_MAX_ATTEMPTS) {
      poolState = 'failed';
      return Promise.reject(new Error(
        `Stockfish engine ${name} could not start after ${BOOT_MAX_ATTEMPTS} attempts` +
        `${lastBootError ? ` (last error: ${lastBootError})` : ''}. ` +
        'Reload the page and try again — if it persists, your browser may be blocking Web Workers or WASM. '
      ));
    }
    bootAttempts += 1;
    poolState = 'booting';
    readySlots = 0;
    bootPromise = new Promise((resolve, reject) => {
      bootReject = reject;
      bootTimer = setTimeout(() => {
        failAll(new Error(`Stockfish engine ${name} failed to boot within ${BOOT_TIMEOUT_MS / 1000}s`));
      }, BOOT_TIMEOUT_MS);
      let remaining = slots.length;
      slots.forEach((slot, index) => {
        let uciOk = false;
        try {
          slot.worker = new Worker(url);
        } catch (err) {
          failAll(err);
          return;
        }
        slot.worker.onmessage = (e) => {
          if (typeof e.data !== 'string') return; // wasm download progress objects
          const line = e.data.trim();
          handleLine(slot, line);
          if (line === 'uciok') {
            uciOk = true;
            // Pin every determinism-relevant option ONCE at boot per worker:
            // a fixed thread count (multi-threaded search is run-to-run non-
            // deterministic), a fixed hash, no pondering. The SF.js WASM build
            // is single-threaded per instance, so `threads` is pinned to 1 for
            // review determinism (`REVIEW_THREADS`) even though the pool can
            // scale out; `hashMb` is however per-worker and configurable
            // (REVIEW_HASH_MB = 128 for review, 16 for the analysis pool).
            // Never changed again → same binary + same settings = same search
            // results on the same machine (each search also clears the TT, see
            // start()).
            postTo(slot, `setoption name Threads value ${threads}`);
            postTo(slot, `setoption name Hash value ${hashMb}`);
            postTo(slot, 'setoption name Ponder value false');
            postTo(slot, 'isready');
          }
          else if (line === 'readyok' && uciOk) {
            readySlots += 1;
            if (--remaining === 0) {
              if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
              poolState = 'ready';
              bootAttempts = 0;
              bootFailedAt = 0;
              lastBootError = '';
              resolve();
            }
          }
        };
        slot.worker.onerror = (ev) => {
          failAll(new Error(ev && ev.message ? ev.message : `Stockfish worker ${name}[${index}] failed`));
        };
        postTo(slot, 'uci');
      });
    });
    return bootPromise;
  }

  /* dispatch to the slot with the least outstanding work */
  function leastLoadedSlot() {
    let best = slots[0];
    for (const s of slots) {
      const load = s.queue.length + (s.current ? 1 : 0);
      const bestLoad = best.queue.length + (best.current ? 1 : 0);
      if (load < bestLoad) best = s;
    }
    return best;
  }

  /* ------------------------------ request API ------------------------------ */

  function search(fen, { depth = 16, movetime = null, skillLevel, multiPvNum = 1 } = {}) {
    return boot().then(
      () => new Promise((resolve, reject) => {
        const slot = leastLoadedSlot();
        const req = {
          slot,
          fen,
          reqDepth: Math.max(1, Math.round(depth) || 1),
          movetime: movetime ? Math.max(1, Math.round(movetime)) : null,
          skill: skillLevel == null ? 20 : Math.max(0, Math.min(20, Math.round(skillLevel))),
          multiPvNum: Math.max(1, Math.min(5, Math.round(multiPvNum))) || 1,
          ranks: {},          // multipv rank -> { depth, cp, mate, pv }
          uci: null,
          resolve,
          reject,
          finished: false,
          stopped: false,
        };
        slot.queue.push(req);
        pumpAll();
      }),
    );
  }

  /* Cancel the running searches and drop everything queued. */
  function abortAll() {
    slots.forEach((slot) => {
      slot.queue.splice(0).forEach((r) => r.resolve(null));
      if (slot.current && !slot.current.stopped) {
        slot.current.stopped = true;
        slot.current.resolve(null);
        postTo(slot, 'stop'); // handleLine's "bestmove" will cleanup and pump this slot
      }
    });
  }

  /* Tear the pool down. This is a REAL teardown, not just a state reset: every
     pending promise must be settled here, because the alternative is a caller
     that awaits it forever. Two things used to leak on this path:

     1. `bootTimer` was left armed. The orphaned timer fired up to
        BOOT_TIMEOUT_MS later and called failAll(), which terminated the NEWLY
        booted, actively-searching workers and marked the pool 'failed' — so a
        perfectly healthy review was killed mid-run, minutes after the click
        that started it. The symptom was an intermittent "Review failed".
     2. The in-flight boot promise and every queued/running search were dropped
        without settling. `slot.queue.length = 0` and `slot.current = null`
        silently discard their resolve/reject, so an awaiting caller (e.g. the
        review pipeline's warm-up probe) waited forever — no error, no progress,
        no timeout. */
  function terminate() {
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    bootFailedAt = 0;
    lastBootError = '';
    poolState = 'idle';
    readySlots = 0;
    bootPromise = null;
    /* Settle the boot handshake before dropping the reject fn, so a caller
       parked in boot() learns why instead of hanging. */
    if (bootReject) { const r = bootReject; bootReject = null; r(new Error(`Stockfish engine ${name} was reset`)); }
    slots.forEach((slot) => {
      if (slot.worker) { try { slot.worker.terminate(); } catch { /* ignore */ } }
      slot.worker = null;
      /* resolve(null) — not reject — matching abortAll(): the engine simply
         produced no evaluation for these positions. reviewCache.remember()
         skips null, so a reset can never poison a later re-analysis into an
         instant "no evaluation" row. */
      if (slot.current && !slot.current.finished) {
        slot.current.finished = true;
        clearTimeout(slot.current.timer);
        slot.current.resolve(null);
      }
      slot.current = null;
      slot.queue.splice(0).forEach((r) => r.resolve(null));
    });
  }

  /* ------------------------------ UCI handling ----------------------------- */

  function pump(slot) {
    if (slot.current || !slot.queue.length) return;
    slot.current = slot.queue.shift();
    start(slot, slot.current);
  }

  /* Keep every worker fed, not just the one that just went idle.
     `pump()` only ever takes from a slot's OWN queue, so a request still runs
     on the slot it was dispatched to — this only changes WHICH free slot picks
     the next waiting request. The old code pumped just the slot that had just
     finished, so a queue on any other slot sat idle until that specific worker
     went free, even if other workers were sitting empty. With the review
     pipeline dispatching more plies than there are workers, that difference is
     the difference between a saturated pool and idle cores. */
  function pumpAll() {
    for (let i = 0; i < slots.length; i++) pump(slots[i]);
  }

  function start(slot, req) {
    /* Re-pin the request to the slot running it. Today this is a no-op: pump()
       only ever shifts from its OWN queue, so a request always runs on the slot
       search() pinned it to, and finish() relies on that to clear `current`.
       Stating it here makes the invariant explicit and keeps finish() correct
       if a future change ever lets a freed worker adopt another slot's queue. */
    req.slot = slot;
    if (req.skill !== slot.skill) {
      slot.skill = req.skill;
      postTo(slot, 'setoption name UCI_LimitStrength value false');
      postTo(slot, `setoption name Skill Level value ${req.skill}`);
    }
    if (req.multiPvNum !== slot.multiPv) {
      slot.multiPv = req.multiPvNum;
      postTo(slot, `setoption name MultiPV value ${slot.multiPv}`);
    }
    // Clear the transposition table before every search so each result is
    // independent of which previous positions this worker happened to see.
    // (Shared TT state made "pool N" reviews vary with worker scheduling and
    // disagree with serial runs — byte-for-byte determinism requires a cold TT.)
    postTo(slot, 'setoption name Clear Hash value true');
    postTo(slot, `position fen ${req.fen}`);
    let go = `go depth ${req.reqDepth}`;
    if (req.movetime) go += ` movetime ${req.movetime}`;
    postTo(slot, go);

    // Safety timeout. Requests that carry an explicit movetime keep a snug
    // grace; FIXED-DEPTH requests (the review pipeline, no movetime) get a very
    // generous one so a slow machine's search is effectively never force-cut —
    // premature cut-offs would make depth-fixed runs non-deterministic.
    const grace = (req.movetime || 120000) + 5000;
    req.timer = setTimeout(() => {
      if (req.finished) return;
      req.stopped = true;
      postTo(slot, 'stop');
      req.timer = setTimeout(() => finish(req, null), 3000); // hard bail-out
    }, grace);
  }

  function handleLine(slot, line) {
    const cur = slot.current;
    if (!cur) return;
    const parts = line.split(/\s+/);

    if (parts[0] === 'info') {
      let depth = 0;
      let cp = null;
      let mate = null;
      let rank = 1;
      let pv = null;
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
      const entry = cur.ranks[rank] || { depth: 0, cp: null, mate: null, pv: [] };
      if (depth >= entry.depth) {
        entry.depth = depth;
        if (cp != null) { entry.cp = cp; entry.mate = null; }
        if (mate != null) { entry.mate = mate; entry.cp = null; }
        if (pv) entry.pv = pv;
      }
      cur.ranks[rank] = entry;
      return;
    }

    if (parts[0] === 'bestmove') {
      cur.uci = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      finish(cur, buildResult(cur));
    }
  }

  /* Normalize UCI scores once, preserving white-perspective mate semantics. */
  function rankFieldsWhite(fen, entry) {
    const sign = (fen.split(/\s+/)[1] || 'w') === 'w' ? 1 : -1;
    return scoreFields(entry.mate != null
      ? { type: 'mate', value: sign * entry.mate, winner: sign * (entry.mate > 0 ? 1 : -1) }
      : { type: 'cp', value: sign * (entry.cp ?? 0) });
  }

  function buildResult(cur) {
    const ranks = cur.ranks;
    const top = ranks[1] || ranks[Object.keys(ranks)[0]] || { depth: 0, cp: 0, mate: null, pv: [] };

    const moves = Object.keys(ranks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((rank) => {
        const entry = ranks[rank];
        const uci = (entry.pv && entry.pv[0]) || (rank === 1 ? cur.uci : null);
        return {
          rank,
          uci,
          from: uci && uci.length >= 4 ? uci.slice(0, 2) : null,
          to: uci && uci.length >= 4 ? uci.slice(2, 4) : null,
          promotion: uci && uci.length > 4 ? uci[4] : null,
          ...rankFieldsWhite(cur.fen, entry),
          depth: entry.depth,
          pv: entry.pv || [],
        };
      })
      .filter((m) => m.uci);

    // if no "info" lines arrived yet, fall back to the raw bestmove
    if (!moves.length && cur.uci) {
      moves.push({
        rank: 1,
        uci: cur.uci,
        from: cur.uci.slice(0, 2),
        to: cur.uci.slice(2, 4),
        promotion: cur.uci.length > 4 ? cur.uci[4] : null,
        score: 0,
        mate: null,
        depth: 0,
        pv: [cur.uci],
      });
    }

    const bestMove = moves[0] || { uci: cur.uci, from: null, to: null, promotion: null, score: 0, mate: null, depth: 0, pv: [] };
    return {
      uci: bestMove.uci,
      from: bestMove.from,
      to: bestMove.to,
      promotion: bestMove.promotion,
      evaluation: bestMove.evaluation || scoreFields(bestMove).evaluation,
      score: bestMove.score,
      mate: bestMove.mate,
      depth: bestMove.depth,
      pv: bestMove.pv,
      moves,
    };
  }

  function finish(req, data) {
    if (req.finished) return;
    req.finished = true;
    clearTimeout(req.timer);
    const slot = req.slot;
    if (slot && slot.current === req) slot.current = null;
    req.resolve(data);
    // free whichever slot is free, not only the one this request ran on
    pumpAll();
  }

  return {
    search, abortAll, terminate, ready: () => boot(),
    /* Health for the UI: lets a failed review explain itself ("engine failed
       to load") instead of blaming the game. */
    status: () => ({ state: poolState, readySlots, totalSlots: slots.length, lastError: lastBootError }),
    /* Clear a POISONED pool so the user's "try again" gets a fresh boot.
       A pool that is already 'ready' is left completely alone: tearing down a
       healthy NNUE pool discards ~113 MB of downloaded+compiled WASM per worker
       and forces the whole review to wait for a cold re-boot, which is both
       slow and pointless. The review pipeline's own searches settle on
       terminate() anyway, and a ready pool has no boot timer left to leak. */
    reset: () => {
      if (poolState === 'ready') return;
      terminate();
      bootAttempts = 0;
    },
  };
}

/* ── default export: the ANALYSIS pool (lite build, single worker) ──
   Used by ./engine.js — live board analysis, the engine bar and computer
   games. Kept as this module's default so `import * as stockfish` keeps
   working exactly as before. */
const analysisPool = createPool({
  poolSize: ANALYSIS_ENGINE_POOL,
  workerUrl: ANALYSIS_ENGINE_URL,
  name: 'analysis',
});

export const search = (fen, opts) => analysisPool.search(fen, opts);
export const abortAll = () => analysisPool.abortAll();
export const terminate = () => analysisPool.terminate();
export const warmEngine = () => analysisPool.ready();