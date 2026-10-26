/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const os = require('os');
const { claimNextJob, completeJob, failJob, renewLease, LEASE_MS } = require('../src/services/analysis/analysisStore');
const { loadGame } = require('../src/services/analysis/gameLoader');
const { analyseGame, getEngine, shutdownEngine, poolSize } = require('../src/services/analysis/analysisRunner');

/* ──────────────── The automatic-analysis worker ────────────────
   A separate process (`npm run worker:analysis`) that drains the queue the
   finish/import hooks fill. It is deliberately NOT in the web server:

     · the web server answers requests, and an engine analysis is measured in
       minutes — running one in-process would hold the event loop, time out the
       request that triggered it, and take the site down when the engine wedged;
     · a worker can be restarted, scaled (one per core) or killed without
       touching the site;
     · the queue is in the database, so a worker that dies loses nothing: its
       lease expires and another worker picks the job up.

   THE LOOP
     claim → load → analyse → write, then repeat. Claims are lease-guarded, so
     several of these can run side by side and none of them can ever analyse the
     same game.

   LEASE RENEWAL
   A long analysis renews its lease while it runs. Without it, a 10-minute
   review on a slow machine would outlive its own lease, be reclaimed as "dead",
   and be analysed a second time in parallel — burning a core to produce a
   result nobody was waiting for.

   ENGINE WARM-UP
   The first claim pays for booting Stockfish (compiling the WASM net, ~113 MB).
   Doing it before the loop means the first job is not charged for it, and a
   missing engine is reported at STARTUP, where an operator will see it, instead
   of once per job as a pile of failed rows. */

const WORKER_ID = process.env.ANALYSIS_WORKER_ID || `${os.hostname()}-${process.pid}`;
const IDLE_SLEEP_MS = Math.max(200, Number(process.env.ANALYSIS_IDLE_SLEEP_MS) || 2000);
/* Renew at a third of the lease, so two missed ticks are still survivable. */
const LEASE_RENEW_MS = Math.max(10_000, Math.min(Math.floor(LEASE_MS / 3), 120_000));
const SHUTDOWN_GRACE_MS = 30_000;

let running = true;
let active = null;
let processed = 0;
let failed = 0;

function log(...args) {
  console.log(`[analysis:${WORKER_ID}]`, ...args);
}

function stop() {
  if (!running) return;
  running = false;
  log('stop requested — finishing the current game, then exiting');
  /* A claimed-but-unwritten game is not lost: the lease expires and another
     worker (or this one on restart) re-runs it. So an immediate exit is safe;
     the grace period is only so an almost-finished analysis gets to land. */
  setTimeout(() => {
    if (!active) process.exit(0);
  }, SHUTDOWN_GRACE_MS).unref();
}

/** One job, start to finish. */
async function runJob(job) {
  const { game_source: gameSource, game_id: gameId, claim_token: claimToken } = job;
  const startedAt = Date.now();
  log(`▶ ${job.jobId} (${job.eligibility})`);

  const loaded = await loadGame(gameSource, gameId);
  if (!loaded.ok) {
    /* A game that is gone, unfinished or ownerless will never become analysable.
       It is recorded as permanently failed rather than retried MAX_ATTEMPTS
       times: retrying only wastes a worker slot per attempt and the row would
       still read 'pending' in the meantime, so the UI would wait for nothing. */
    await failJob({
      gameSource, gameId, claimToken,
      error: `not analysable: ${loaded.reason}`,
      maxAttempts: 1,
    });
    log(`✗ ${job.jobId} — ${loaded.reason}`);
    failed += 1;
    return;
  }

  const { game } = loaded;

  /* Renew while the engine grinds. A failure to renew is logged and ignored on
     purpose: the write below is still lease-guarded, so the worst case is that
     the write is refused and the job is re-run, not that two results collide. */
  const renewer = setInterval(() => {
    renewLease(gameSource, gameId, claimToken).catch(() => {});
  }, LEASE_RENEW_MS);
  renewer.unref();

  try {
    const engine = await getEngine();
    const result = await analyseGame({
      game,
      engine,
      isCancelled: () => !running,
      onProgress: (done, total) => {
        if (done === total) log(`  ${job.jobId}: analysed ${done}/${total} plies`);
      },
    });

    if (!result.ok) {
      const outcome = await failJob({
        gameSource, gameId, claimToken,
        error: result.reason,
        /* A permanent failure spends all attempts at once — see above. */
        maxAttempts: result.permanent ? 1 : undefined,
      });
      log(`✗ ${job.jobId} — ${result.reason} (${outcome.status || 'lease lost'})`);
      failed += 1;
      return;
    }

    const written = await completeJob({
      gameSource, gameId, claimToken,
      summary: result.summary,
      moves: result.moves,
    });

    if (!written.ok) {
      log(`⚠ ${job.jobId} — result discarded: ${written.reason}`);
      failed += 1;
      return;
    }

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(
      `✔ ${job.jobId} — ${written.movesWritten} moves, `
      + `white ${result.summary.accuracyWhite}% / black ${result.summary.accuracyBlack}% (${secs}s)`,
    );
    processed += 1;
  } catch (err) {
    /* Anything that escapes analyseGame is an engine or environment problem, not
       a property of this game — so it is a normal failure that retries. */
    console.error(`[analysis:${WORKER_ID}] ${job.jobId} crashed:`, err);
    await failJob({ gameSource, gameId, claimToken, error: err }).catch(() => {});
    failed += 1;
  } finally {
    clearInterval(renewer);
    active = null;
  }
}

async function main() {
  log(`starting — engine pool ${poolSize()}, lease renew every ${Math.round(LEASE_RENEW_MS / 1000)}s`);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    await getEngine();
    log('engine ready');
  } catch (err) {
    /* Loud and fatal on purpose: a worker that cannot reach an engine must not
       sit claiming jobs and failing them, because each failure burns an attempt
       and can push a game to 'failed' for a reason that has nothing to do with
       the game. */
    console.error(`[analysis:${WORKER_ID}] engine unavailable: ${err.message}`);
    console.error('  Check that frontend/public/stockfish.js and stockfish.wasm exist,');
    console.error('  and that frontend/node_modules is installed.');
    process.exit(1);
  }

  while (running) {
    try {
      const job = await claimNextJob({ workerId: WORKER_ID });
      if (!job) {
        await sleep(IDLE_SLEEP_MS);
        continue;
      }
      active = job;
      await runJob(job);
    } catch (err) {
      /* The loop itself must never die: a transient database blip would
         otherwise end the worker with a queue full of unclaimed jobs. */
      console.error(`[analysis:${WORKER_ID}] loop error:`, err);
      await sleep(IDLE_SLEEP_MS);
    }
  }

  await shutdownEngine();
  log(`stopped — ${processed} analysed, ${failed} failed`);
  await require('../src/config/database').pool.end();
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
}

/* `--once` drains whatever is queued and exits, which is what a backfill or a
   cron invocation wants; the default loops forever. */
if (process.argv.includes('--once')) {
  (async () => {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try { await getEngine(); } catch (err) {
      console.error(`engine unavailable: ${err.message}`);
      process.exit(1);
    }
    while (running) {
      const job = await claimNextJob({ workerId: WORKER_ID });
      if (!job) break;
      active = job;
      await runJob(job);
    }
    await shutdownEngine();
    log(`done — ${processed} analysed, ${failed} failed`);
    await require('../src/config/database').pool.end();
    process.exit(0);
  })();
} else {
  main();
}
