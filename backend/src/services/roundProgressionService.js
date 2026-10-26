'use strict';

const db = require('../config/database');
const engine = require('./tournamentEngine');
const rt = require('./tournamentRealtime');

let tableReady = null;

async function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS tournament_progression (
         id BIGSERIAL PRIMARY KEY,
         tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
         reason VARCHAR(64) NOT NULL DEFAULT 'game_finalized',
         status VARCHAR(16) NOT NULL DEFAULT 'pending',
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    ).then(() =>
      db.query(
        `CREATE INDEX IF NOT EXISTS idx_tournament_progression_pending
           ON tournament_progression (status, available_at, id)`
      )
    );
  }
  return tableReady;
}

/* Durable enqueue: survives crash/restart. One pending row per tournament. */
async function enqueue(tournamentId, reason = 'game_finalized') {
  try {
    await ensureTable();
    await db.query(
      `INSERT INTO tournament_progression (tournament_id, reason)
       SELECT $1, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM tournament_progression
           WHERE tournament_id = $1 AND status = 'pending'
        )`,
      [Number(tournamentId), reason]
    );
  } catch (e) {
    if (e && e.code === '42P01') {
      tableReady = null;
    }
  }
  return { ok: true };
}

async function processTournament(io, tournamentId) {
  const t = await db.query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const row = t.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (!['active', 'paused'].includes(row.status)) return { ok: true, skipped: 'status' };
  /* Timeout / no-show enforcement first so a forfeited board can unblock the
     round completion that tickTournament does next. */
  await engine.enforceGames(row.id);
  const res = await engine.tickTournament(row.id);
  if (res && res.advanced) {
    rt.emitTournament(io, row.id, 'round.completed', { ok: true });
    rt.emitTournament(io, row.id, 'round.pairings.generated', { ok: true });
    rt.emitTournament(io, row.id, 'round.started', { ok: true });
  }
  rt.emitTournament(io, row.id, 'tournament.updated', { status: row.status });
  return res || { ok: true };
}

/* Claim one pending row with SKIP LOCKED so several workers never overlap. */
async function claimRow() {
  const r = await db.query(
    `UPDATE tournament_progression
        SET status = 'processing', attempts = attempts + 1,
            updated_at = NOW()
      WHERE id = (
        SELECT id FROM tournament_progression
         WHERE status = 'pending' AND available_at <= NOW()
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
     RETURNING *`
  );
  return r.rows[0] || null;
}

async function processOnce(io) {
  const row = await claimRow();
  if (!row) return false;
  try {
    await processTournament(io, row.tournament_id);
    await db.query(
      "UPDATE tournament_progression SET status = 'done', last_error = NULL, updated_at = NOW() WHERE id = $1",
      [row.id]
    );
  } catch (err) {
    const failed = Number(row.attempts) >= 5;
    await db.query(
      `UPDATE tournament_progression
          SET status = $2,
              last_error = $3,
              available_at = CASE WHEN $2 = 'failed' THEN available_at ELSE available_at + interval '2 seconds' END,
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, failed ? 'failed' : 'pending', String(err.message || err).slice(0, 2000)]
    ).catch(() => {});
    rt.emitTournament(io, row.tournament_id, 'tournament.progression.failed', {
      message: String(err.message || err),
    });
  }
  return true;
}

async function runBatch(io, max = 20) {
  let n = 0;
  while (n < max && (await processOnce(io))) n += 1;
  return n;
}

/* In-process worker: drains the outbox on an interval. Safe with multiple
   server processes thanks to SKIP LOCKED. */
function startWorker(io, intervalMs) {
  const ms = Number(intervalMs) || Number(process.env.TOURNAMENT_WORKER_MS) || 2000;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runBatch(io);
    } catch (e) {
      /* keep the worker alive */
    } finally {
      running = false;
    }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { enqueue, processTournament, processOnce, runBatch, startWorker, ensureTable };
