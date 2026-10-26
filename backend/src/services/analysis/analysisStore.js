/* eslint-disable no-console */
const db = require('../../config/database');
const { classifyGame, profileImportBudget, ELIGIBILITY_PRIORITY } = require('./eligibility');

/* ──────────── The automatic-analysis job store ────────────

   The queue IS the game_stockfish_analysis table. There is no Redis, no BullMQ
   and no in-memory queue: a row's `status` is simultaneously the job state and
   the API's answer to "is this game analysed yet?", which is the property that
   matters. Two processes can look at the same row and cannot disagree about it.

   THE STATE MACHINE
     (no row)      → nothing queued yet. The API reports status 'absent'.
     pending       → queued, waiting for a worker.
     processing    → a worker holds a LEASE on it and is running.
     done          → every ply has a verdict row; the only state the UI renders.
     failed        → out of attempts; error_message says why.

   WHY A LEASE AND NOT A PLAIN 'processing' FLAG
   A worker that is killed mid-analysis — deploy, OOM, laptop closed — leaves
   its job stuck in 'processing' FOREVER, because nobody is left holding it.
   The classic symptom is a game that silently never gets analysed. So a claim
   stamps `lease_expires_at`; a job still in 'processing' after that instant is
   treated as unclaimed and re-run. A slow-but-alive worker therefore keeps its
   job (it renews the lease), and a dead worker loses it (nobody renews).

   WHY CLAIMING USES FOR UPDATE SKIP LOCKED
   Several workers can run at once (one per core). Without row locking, two of
   them read the same 'pending' row and both run a 30-second analysis of the
   same game. SKIP LOCKED makes the second worker step over the locked row and
   take the next one, so no two workers can ever hold the same game.

   WHY ENQUEUE IS AN UPSERT THAT IGNORES CONFLICTS
   `ON CONFLICT (game_source, game_id) DO NOTHING`. The same game can be queued
   from four directions — a duplicate finish event, a re-sync of the same
   account, a manual retry, a backfill — and the row must not be duplicated or
   reset. It also means an ALREADY-DONE game is left alone, which is what makes
   enqueueing safe to call on every single save. */

const MAX_ATTEMPTS = Math.max(1, Number(process.env.ANALYSIS_MAX_ATTEMPTS) || 3);
const LEASE_MS = Math.max(30_000, Number(process.env.ANALYSIS_LEASE_MS) || 15 * 60_000);

/**
 * The deterministic job id. Same game → same id, forever, so logs, socket
 * events and the API can all refer to one job without a lookup, and a retried
 * job is recognisably the same job rather than a second one.
 */
function jobIdFor(gameSource, gameId) {
  return `analysis-${gameSource}-${gameId}`;
}

/**
 * Queue a game for analysis if it is eligible.
 *
 * Never throws for an ineligible game and never rejects: enqueueing is called
 * from the middle of a save (a game being stored), and a failed enqueue must
 * not roll back or 500 the save. A queue that is down degrades the FEATURE, not
 * the app — the student can still open the game and analyse it in the browser
 * exactly as before.
 *
 * @returns {{queued: boolean, reason: string, jobId?: string, eligibility?: string}}
 */
async function enqueueGame({ gameSource, gameId, ownerUserId, pgn, movesCount, force = false }) {
  const gameIdNum = Number(gameId);
  if (!Number.isInteger(gameIdNum) || gameIdNum <= 0) {
    return { queued: false, reason: 'bad_game_id' };
  }
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) {
    /* Without an owner there is nobody to show the result to, and the column is
       NOT NULL — an orphan row would be unreadable. */
    return { queued: false, reason: 'no_owner' };
  }

  const verdict = classifyGame({ gameSource, pgn, movesCount });
  if (!verdict.eligible && !force) {
    return { queued: false, reason: verdict.reason };
  }
  const eligibility = force ? (verdict.eligibility || 'app_played') : verdict.eligibility;

  /* Bulk-import throttle: a 500-game sync must not push 500 jobs in front of
     the game a student just finished. Only profile_import is capped.

     Inside the try: the doc comment above promises enqueueGame never rejects,
     and the budget COUNT is a database round-trip like any other. If the database
     is refusing queries, the honest answer is "not queued", not an exception
     thrown up into a student's save-game request. */
  if (eligibility === 'profile_import' && !force) {
    try {
      const { rows } = await db.query(
        `SELECT count(*)::int AS queued
           FROM game_stockfish_analysis
          WHERE eligibility = 'profile_import'
            AND status IN ('pending', 'processing')`,
      );
      const queued = rows[0] ? rows[0].queued : 0;
      /* budget() is the remaining allowance; 0 means the queue is full. */
      const remaining = profileImportBudget({ queuedProfileImports: queued });
      if (remaining <= 0) {
        return { queued: false, reason: 'import_queue_full', jobId: jobIdFor(gameSource, gameIdNum) };
      }
    } catch (err) {
      console.error('[analysis] import budget check failed:', err.message);
      return { queued: false, reason: 'budget_check_failed', jobId: jobIdFor(gameSource, gameIdNum) };
    }
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO game_stockfish_analysis
         (owner_user_id, game_source, game_id, eligibility, status, requested_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       ON CONFLICT (game_source, game_id) DO NOTHING
       RETURNING id`,
      [ownerUserId, gameSource, gameIdNum, eligibility],
    );
    /* No returned row means the game was already queued — which is a SUCCESS
       from the caller's point of view, not a failure. Saying so keeps the
       duplicate-finish-event path silent. */
    return {
      queued: true,
      reason: rows.length ? 'enqueued' : 'already_queued',
      jobId: jobIdFor(gameSource, gameIdNum),
      eligibility,
    };
  } catch (err) {
    console.error('[analysis] enqueue failed:', err.message);
    return { queued: false, reason: 'enqueue_failed', error: err.message };
  }
}

/**
 * Take the next job, or null when there is nothing to do.
 *
 * Expired `processing` rows are reclaimed (the previous holder died), and
 * app_played always outranks profile_import. The claim token is what every later
 * write must present, so a job that was reclaimed and re-run elsewhere cannot
 * be written to by the worker that still thinks it owns the old attempt.
 */
async function claimNextJob({ workerId } = {}) {
  const token = `${workerId || 'worker'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const { rows } = await db.query(
      `UPDATE game_stockfish_analysis ga
          SET status = 'processing',
              claim_token = $1,
              lease_expires_at = NOW() + ($2 || ' milliseconds')::interval,
              attempts = ga.attempts + 1,
              updated_at = NOW()
         WHERE ga.id = (
             SELECT c.id
               FROM game_stockfish_analysis c
              WHERE c.status = 'pending'
                 OR (c.status = 'processing' AND c.lease_expires_at < NOW())
              ORDER BY CASE c.eligibility WHEN 'app_played' THEN 0 ELSE 1 END,
                       c.requested_at ASC
              LIMIT 1
                FOR UPDATE SKIP LOCKED
         )
       RETURNING ga.*`,
      [token, String(LEASE_MS)],
    );
    if (!rows.length) return null;
    return { ...rows[0], jobId: jobIdFor(rows[0].game_source, rows[0].game_id) };
  } catch (err) {
    console.error('[analysis] claim failed:', err.message);
    return null;
  }
}

/**
 * Extend a claim. Called while a long analysis runs so a 10-minute review is
 * not mistaken for a dead worker and analysed twice.
 */
async function renewLease(gameSource, gameId, claimToken, ms = LEASE_MS) {
  const { rows } = await db.query(
    `UPDATE game_stockfish_analysis
        SET lease_expires_at = NOW() + ($4 || ' milliseconds')::interval
      WHERE game_source = $1 AND game_id = $2 AND claim_token = $3 AND status = 'processing'
      RETURNING id`,
    [gameSource, gameId, claimToken, String(ms)],
  );
  return rows.length > 0;
}

/**
 * Store a finished analysis. One transaction: the game row flips to done and
 * its move rows are replaced. If the process dies between the two, the job must
 * not read as done with the OLD moves still attached — that is exactly the
 * "accuracy says one thing, the badges say another" corruption.
 */
async function completeJob({ gameSource, gameId, claimToken, summary, moves }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    /* Only the holder of the lease may finish the job. Without this, a worker
       whose lease expired mid-run (and whose job was already reclaimed and
       completed by another worker) would overwrite the newer result with its
       older one. */
    const owned = await client.query(
      `SELECT id FROM game_stockfish_analysis
        WHERE game_source = $1 AND game_id = $2 AND claim_token = $3 AND status = 'processing'
        FOR UPDATE`,
      [gameSource, gameId, claimToken],
    );
    if (!owned.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'lease_lost' };
    }

    /* Replace, don't merge: a re-analysis at a new depth can reclassify a move,
       and the old verdict for that ply must not survive next to the new one. */
    await client.query(
      `DELETE FROM move_stockfish_analysis WHERE game_source = $1 AND game_id = $2`,
      [gameSource, gameId],
    );

    if (moves && moves.length) {
      /* One multi-row INSERT instead of one round trip per ply. A 120-ply game
         would otherwise be 120 network waits inside the same transaction.

         $1/$2 are the shared (game_source, game_id) pair; each row appends its
         own 14 values, so its placeholders start at $3. Deriving them from the
         running param length is what keeps that offset honest — hard-coding
         $1..$16 per row would silently misalign every column after the first
         row, or fail outright ("could not determine data type of parameter"). */
      const values = [];
      const params = [gameSource, gameId];
      for (const m of moves) {
        const base = params.length; // first free placeholder is base + 1
        values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
                     $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9},
                     $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`);
        params.push(
          m.ply, m.player, m.verdict,
          m.moveSan ?? null, m.moveUci ?? null, m.fenBefore ?? null,
          m.evalBest ?? null, m.evalPlayed ?? null, m.cpl ?? null, m.wpd ?? null,
          m.bestUci ?? null, m.depth ?? null, m.bookLine ?? null, m.sigmaType ?? null,
        );
      }
      await client.query(
        `INSERT INTO move_stockfish_analysis
           (game_source, game_id, ply, player, verdict, move_san, move_uci,
            fen_before, eval_best, eval_played, cpl, wpd, best_uci, depth,
            book_line, sigma_type)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    await client.query(
      `UPDATE game_stockfish_analysis
          SET status = 'done',
              accuracy_white = $4,
              accuracy_black = $5,
              opening_name = $6,
              eco_code = $7,
              game_classification = $8,
              analysis_depth = $9,
              engine_version = $10,
              result = $11,
              error_message = NULL,
              analyzed_at = NOW(),
              updated_at = NOW(),
              lease_expires_at = NULL
        WHERE game_source = $1 AND game_id = $2 AND claim_token = $3`,
      [
        gameSource, gameId, claimToken,
        summary.accuracyWhite ?? null, summary.accuracyBlack ?? null,
        summary.openingName ?? null, summary.ecoCode ?? null,
        summary.gameClassification ?? null,
        summary.analysisDepth ?? null, summary.engineVersion ?? null,
        summary.result ?? null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, movesWritten: moves ? moves.length : 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[analysis] complete failed:', err.message);
    return { ok: false, reason: 'write_failed', error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Record a failed attempt. The job only reaches 'failed' once its attempts are
 * spent; before that it goes back to 'pending' so a transient engine hiccup
 * retries on its own without a student pressing anything.
 */
async function failJob({ gameSource, gameId, claimToken, error, maxAttempts = MAX_ATTEMPTS }) {
  const message = String(error && error.message ? error.message : error || 'unknown error').slice(0, 500);
  try {
    const { rows } = await db.query(
      `UPDATE game_stockfish_analysis
          SET status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'pending' END,
              error_message = $5,
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE game_source = $1 AND game_id = $2 AND claim_token = $3
        RETURNING status, attempts, error_message`,
      [gameSource, gameId, claimToken, maxAttempts, message],
    );
    if (!rows.length) return { ok: false, reason: 'lease_lost' };
    return { ok: true, status: rows[0].status, attempts: rows[0].attempts, error: rows[0].error_message };
  } catch (err) {
    console.error('[analysis] fail recorded failed:', err.message);
    return { ok: false, reason: 'write_failed', error: err.message };
  }
}

/**
 * Put a finished or failed job back in the queue — the manual "analyse again"
 * button. Resets attempts so the user is not locked out by a job that failed
 * three times while the engine was down.
 */
async function requeueGame({ gameSource, gameId }) {
  const { rows } = await db.query(
    `UPDATE game_stockfish_analysis
        SET status = 'pending',
            attempts = 0,
            error_message = NULL,
            claim_token = NULL,
            lease_expires_at = NULL,
            requested_at = NOW(),
            updated_at = NOW()
      WHERE game_source = $1 AND game_id = $2
        AND (status = 'done' OR status = 'failed')
      RETURNING owner_user_id, eligibility`,
    [gameSource, gameId],
  );
  return rows.length ? { requeued: true, ownerUserId: rows[0].owner_user_id } : { requeued: false };
}

/** Queue counts for the admin/status screen. Cheap enough to poll. */
async function queueStats() {
  const { rows } = await db.query(
    `SELECT status, count(*)::int AS count
       FROM game_stockfish_analysis
      GROUP BY status`,
  );
  const byStatus = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of rows) byStatus[r.status] = r.count;
  const { rows: byTier } = await db.query(
    `SELECT eligibility, count(*)::int AS count
       FROM game_stockfish_analysis
      WHERE status = 'pending'
      GROUP BY eligibility`,
  );
  const pendingByTier = {};
  for (const r of byTier) pendingByTier[r.eligibility] = r.count;
  return {
    ...byStatus,
    pendingByTier,
    maxAttempts: MAX_ATTEMPTS,
    leaseMs: LEASE_MS,
    /* Exposed so the caller can show the queue in the same order it is drained. */
    priority: ELIGIBILITY_PRIORITY,
  };
}

module.exports = {
  MAX_ATTEMPTS,
  LEASE_MS,
  jobIdFor,
  enqueueGame,
  claimNextJob,
  renewLease,
  completeJob,
  failJob,
  requeueGame,
  queueStats,
};
