/* eslint-disable no-console */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadGame } = require('./gameLoader');

/* ──────────── Running one analysis ────────────

   The verdict logic is NOT reimplemented here. It is imported from the
   frontend — the exact same modules the in-browser review runs
   (src/utils/gameReview.js + reviewConfig.js + reviewClassify.js +
   reviewAccuracy.js + openings.js), behind the exact same Node Stockfish the
   browser uses (frontend/scripts/nodeEngine.mjs, which speaks UCI to the bundled
   SF.js WASM build).

   That is the whole point. A second implementation of the thresholds would
   drift, and the drift would be invisible: the same move would carry a
   different badge depending on whether it was analysed in the browser or in the
   background, and the stored result would disagree with the live one on the very
   same screen. backfill_sigma_moves.js already imports a frontend classifier
   for exactly this reason.

   The bridge is `reviewGame(initialFen, moves, { engine })` — gameReview.js
   takes an engine override precisely so it can run outside a browser, which is
   what every Node harness already does.

   ESM FROM COMMONJS
   The backend is CommonJS; these frontend modules are ESM. `import()` works
   from CommonJS in Node, and the specifier has to be a file:// URL on Windows.
   The modules are loaded ONCE per process and cached: they are the biggest
   thing the worker touches and re-importing them per game would re-run their
   top-level work for nothing. */

const FRONTEND_SRC = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'utils');
const FRONTEND_SCRIPTS = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'scripts');

let modulesPromise = null;

/**
 * Load (once) every frontend module the analysis needs.
 *
 * Cached on the promise, not the resolved value, so a burst of concurrent jobs
 * cannot each start their own import — that is the standard way to make an
 * expensive async init safe.
 */
function loadReviewModules() {
  if (!modulesPromise) {
    const file = (p) => pathToFileURL(p).href;
    modulesPromise = (async () => {
      const [gameReview, reviewConfig, chess] = await Promise.all([
        import(file(path.join(FRONTEND_SRC, 'gameReview.js'))),
        import(file(path.join(FRONTEND_SRC, 'reviewConfig.js'))),
        import('chess.js'),
      ]);
      return { gameReview, reviewConfig, chess };
    })().catch((err) => {
      /* Clear the cache so the next job retries the import rather than
         inheriting this rejection forever. */
      modulesPromise = null;
      throw err;
    });
  }
  return modulesPromise;
}

/**
 * The engine pool: N Stockfish subprocesses, one job at a time each.
 *
 * N defaults to one per spare core. Each subprocess holds ~113 MB of WASM net
 * plus a 128 MB hash, so this is a deliberate throughput/footprint trade and is
 * tunable (ANALYSIS_ENGINE_POOL) rather than hard-coded.
 */
function poolSize() {
  const explicit = Number(process.env.ANALYSIS_ENGINE_POOL);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  const cores = require('os').cpus()?.length || 2;
  return Math.max(1, Math.min(4, cores - 1));
}

let enginePromise = null;
let enginePool = null;

async function getEngine() {
  if (!enginePromise) {
    const file = pathToFileURL(path.join(FRONTEND_SCRIPTS, 'nodeEngine.mjs')).href;
    enginePromise = import(file)
      .then((mod) => {
        /* Prefer the pool: several subprocesses is the difference between a
           40-ply game taking ~15s and ~60s. A single engine is still correct,
           just slower, so a missing pool helper degrades throughput only. */
        enginePool = mod.createReviewEnginePool
          ? mod.createReviewEnginePool({ size: poolSize() })
          : mod.createReviewEngine();
        return enginePool;
      })
      .catch((err) => {
        enginePromise = null;
        throw err;
      });
  }
  return enginePromise;
}

/** Shut the engine subprocesses down so the worker process can exit cleanly. */
async function shutdownEngine() {
  if (enginePool && typeof enginePool.destroy === 'function') {
    try { await enginePool.destroy(); } catch { /* already dead */ }
  }
  enginePool = null;
  enginePromise = null;
}

/**
 * Parse a PGN into the (initialFen, SAN moves) pair reviewGame wants.
 *
 * `strict: false` mirrors the browser: games this app stored have no [Event] or
 * [Site] tags and would fail a strict parse of a perfectly good game.
 * A PGN that yields zero moves is an error here rather than downstream — the
 * review's own "no legal moves" message is written for a person at a keyboard,
 * not for a queue log.
 */
async function movesFromPgn(pgn, fallbackFen) {
  const { chess } = await loadReviewModules();
  const game = new chess.Chess();
  game.loadPgn(pgn, { strict: false });
  const moves = game.history().filter(Boolean);
  if (!moves.length) throw new Error('The stored PGN has no moves to analyse');
  const tagFen = (String(pgn).match(/\[FEN\s+"([^"]+)"/i) || [])[1];
  return { initialFen: tagFen || fallbackFen || 'start', moves };
}

/**
 * The game-level badge.
 *
 * Not a fresh invention: the review already aggregates per-verdict counts per
 * side, so the headline is the verdict the player actually committed most often,
 * read straight off their own tally. Null when they have no verdicted moves at
 * all, which is a real state (every ply fell back to a neutral row) and must not
 * be dressed up as a rating.
 */
function classifyGameFromSides(white, black) {
  /* Worst-first, so a single blunder is never smoothed away by a pile of
     "best" moves — the badge is a summary of the worst thing that happened. */
  const severity = ['blunder', 'miss', 'mistake', 'inaccuracy', 'strange', 'good', 'book', 'excellent', 'best', 'great', 'brilliant'];
  for (const side of [white, black]) {
    if (!side || !side.counts) continue;
    for (const v of severity) {
      if ((side.counts[v] || 0) > 0) return v;
    }
  }
  return null;
}

/** accuracy is 0-100 in the review's aggregate; the column is NUMERIC(5,2). */
function accuracyOf(side) {
  const n = side && Number(side.accuracy);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Analyse one game and return the rows to store.
 *
 * Never touches the database — persistence is the store's job (completeJob), so
 * this stays a pure "PGN in, verdicts out" step that a test can drive with a
 * stub engine.
 *
 * @returns {{ok: true, summary: object, moves: object[]}|{ok: false, reason: string, permanent?: boolean}}
 */
async function analyseGame({ game, engine, isCancelled = () => false, onProgress }) {
  let gameReview;
  let config;
  try {
    ({ gameReview, reviewConfig: config } = await loadReviewModules());
  } catch (err) {
    /* A frontend import failure is permanent for this process: retrying it per
       job would just re-throw. Recorded as such so the queue drains instead of
       hammering a broken deployment. */
    return { ok: false, reason: `review_modules_unavailable: ${err.message}`, permanent: true };
  }

  let parsed;
  try {
    parsed = await movesFromPgn(game.pgn, game.initialFen);
  } catch (err) {
    return { ok: false, reason: `unreplayable_pgn: ${err.message}`, permanent: true };
  }

  let result;
  try {
    result = await gameReview.reviewGame(parsed.initialFen, parsed.moves, {
      engine: engine || (await getEngine()),
      isCancelled,
      onProgress,
    });
  } catch (err) {
    /* reviewGame throws for a bad starting position, an unreadable move list
       and "the engine returned no evaluations". All three are this game's own
       problem and none will fix themselves on a retry. */
    return { ok: false, reason: `review_failed: ${err.message}`, permanent: true };
  }

  if (!result || !Array.isArray(result.moves) || !result.moves.length) {
    return { ok: false, reason: 'no_verdicts', permanent: true };
  }

  /* Opening identification. The platform's own ECO is authoritative when the
     source carries one (chess.com/Lichess classify at import time); the review's
     own `openingTag` — a prefix match against the curated local book, which has
     no ECO codes at all — is the fallback for the in-app sources. Guessing an
     ECO out of a book NAME would put a fabricated "B20" on the screen, which is
     worse than storing the name alone. */
  const bookOpening = typeof result.opening === 'string' ? result.opening : null;
  const openingName = game.openingName || bookOpening || null;
  const ecoCode = game.ecoCode || null;

  const moves = result.moves.map((row) => ({
    ply: row.ply,
    player: row.player,
    verdict: row.verdict,
    moveSan: row.san,
    moveUci: row.uci,
    fenBefore: row.fenBefore || null,
    /* The review already stores these MOVER-perspective, which is what the
       column documents — no sign flip here, which is deliberate: flipping it
       twice is how a Black blunder ends up displayed as a White one. */
    evalBest: row.best == null ? null : Math.round(row.best),
    evalPlayed: row.played == null ? null : Math.round(row.played),
    cpl: row.loss == null ? null : Math.round(row.loss),
    /* winPercentDrop is ALREADY percentage points (0-100); scaling it here
       would turn a 3% drop into 300 and every quality filter downstream. */
    wpd: row.wpd == null ? null : Math.round(row.wpd * 100) / 100,
    bestUci: row.bestUci || null,
    depth: row.depth || 0,
    bookLine: row.bookLine || null,
    sigmaType: row.sigma && row.sigma.type ? row.sigma.type : null,
  }));

  const summary = {
    accuracyWhite: accuracyOf(result.white),
    accuracyBlack: accuracyOf(result.black),
    openingName,
    ecoCode,
    gameClassification: classifyGameFromSides(result.white, result.black),
    /* The depth actually reached, so a reader can tell a full-depth result from
       one where every ply fell back to a neutral row at depth 0. */
    analysisDepth: Number(config.REVIEW_DEPTH) || null,
    engineVersion: config.REVIEW_ENGINE_VERSION || null,
    result: {
      initialFen: result.initialFen,
      total: result.total,
      white: result.white,
      black: result.black,
      playedAt: game.playedAt,
      whiteName: game.whiteName,
      blackName: game.blackName,
      plies: moves.length,
    },
  };

  return { ok: true, summary, moves };
}

module.exports = {
  analyseGame,
  movesFromPgn,
  classifyGameFromSides,
  loadReviewModules,
  getEngine,
  shutdownEngine,
  poolSize,
};
