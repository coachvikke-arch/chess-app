/* eslint-disable no-console */
const db = require('../config/database');
const { enqueueGame, requeueGame, queueStats, jobIdFor } = require('../services/analysis/analysisStore');
const { loadGame } = require('../services/analysis/gameLoader');

/* ──────────────── Automatic analysis: the read/write API ────────────────

   THE POINT OF THIS CONTROLLER
   The Game Analysis / Game Review page opens instantly because it READS a
   stored result instead of running Stockfish inside the request. The analysis
   itself happens in a separate worker process (scripts/analysis_worker.js),
   triggered by the game-finish and import hooks. Nothing here computes an
   evaluation — this only ever reads rows the worker wrote, or reports "not yet".

   WHY THE SOURCE IS PART OF THE PATH
   There is no single `games` table: online_games / computer_games / chess_games
   / tournament_games each number from 1, so a game id names a different game
   depending on the source. A route without a source in the path would silently
   return the wrong game's analysis whenever ids collide — and they collide
   constantly. So: /api/analysis/games/:gameSource/:gameId.

   WHY 'absent' IS A FIRST-CLASS ANSWER
   Five states are genuinely different to a UI and must not be collapsed:
     absent     — never queued (not eligible, or too new)
     pending    — queued, waiting for a worker
     processing — being analysed right now
     done       — here are the verdicts
     failed     — gave up; error_message says why
   Collapsing 'absent' into 'pending' makes the page either give up too early or
   poll forever. `retryAfterMs` says when to ask again and is null when asking
   again is pointless (done / failed / absent). */

const GAME_SOURCES = ['chess_profile', 'online', 'computer', 'tournament'];

/** Poll cadence the client is told to use, by state. */
const RETRY_AFTER = { pending: 4000, processing: 8000 };

function roleIsAdmin(user) {
  const role = user && user.role;
  return role === 'admin' || role === 'superadmin';
}

/**
 * May this user read this game's analysis?
 *
 * Same per-source shape sigma_moves uses, for the same reason: an online or
 * tournament game has TWO players and both legitimately open it. The analysis
 * is stored once and both players may read it — which is why owner_user_id is
 * the student rather than "whoever triggered it first".
 *
 * An admin may read any of them: a coach reviewing a student's game is a core
 * flow, and gating it on the student logging in would break it.
 */
async function mayRead(gameSource, gameId, user) {
  if (roleIsAdmin(user)) return true;
  const id = Number(gameId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (gameSource === 'chess_profile') {
    const r = await db.query(
      `SELECT 1 FROM chess_games g
         JOIN connected_chess_accounts a ON a.id = g.account_id
        WHERE g.id = $1 AND a.user_id = $2`,
      [id, user.id],
    );
    return r.rows.length > 0;
  }
  if (gameSource === 'computer') {
    const r = await db.query(
      'SELECT 1 FROM computer_games WHERE id = $1 AND student_user_id = $2',
      [id, user.id],
    );
    return r.rows.length > 0;
  }
  if (gameSource === 'online') {
    const r = await db.query(
      'SELECT 1 FROM online_games WHERE id = $1 AND (admin_id = $2 OR student_id = $2)',
      [id, user.id],
    );
    return r.rows.length > 0;
  }
  if (gameSource === 'tournament') {
    const r = await db.query(
      'SELECT 1 FROM tournament_games WHERE id = $1 AND (white_player = $2 OR black_player = $2)',
      [id, user.id],
    );
    return r.rows.length > 0;
  }
  return false;
}

/** 400 for a malformed path parameter, so a typo never reads as "not found". */
function validate(req, res) {
  const { gameSource } = req.params;
  const gameId = Number(req.params.gameId);
  if (!GAME_SOURCES.includes(gameSource)) {
    res.status(400).json({ message: `Unknown game source '${gameSource}'`, gameSources: GAME_SOURCES });
    return null;
  }
  if (!Number.isInteger(gameId) || gameId <= 0) {
    res.status(400).json({ message: 'gameId must be a positive integer' });
    return null;
  }
  return { gameSource, gameId };
}

/**
 * GET /api/analysis/games/:gameSource/:gameId
 *
 * The page's own load. Stored summary + per-move verdict rows in ply order, or
 * a status the client can act on.
 */
async function getAnalysis(req, res) {
  const v = validate(req, res);
  if (!v) return;
  const { gameSource, gameId } = v;
  try {
    if (!(await mayRead(gameSource, gameId, req.user))) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const head = await db.query(
      `SELECT status, error_message, attempts, eligibility,
              accuracy_white, accuracy_black, opening_name, eco_code,
              game_classification, analysis_depth, engine_version,
              requested_at, analyzed_at, result
         FROM game_stockfish_analysis
        WHERE game_source = $1 AND game_id = $2`,
      [gameSource, gameId],
    );

    if (!head.rows.length) {
      /* No row at all: either not eligible, or too new to be queued yet. Either
         way `retryAfterMs` is null, because polling cannot change the answer. */
      return res.json({
        gameSource, gameId, status: 'absent', retryAfterMs: null, analysis: null, moves: [],
      });
    }

    const row = head.rows[0];
    const base = {
      gameSource,
      gameId,
      status: row.status,
      eligibility: row.eligibility,
      retryAfterMs: RETRY_AFTER[row.status] ?? null,
      error: row.error_message || null,
      requestedAt: row.requested_at,
      analyzedAt: row.analyzed_at,
      analysis: null,
      moves: [],
    };

    /* Only a DONE game has a result worth reading. Serving a partial one is the
       exact failure this feature exists to remove, so 'processing' returns no
       analysis object at all rather than a half-populated one. */
    if (row.status !== 'done') return res.json(base);

    const movesRes = await db.query(
      `SELECT ply, player, verdict, move_san, move_uci, fen_before,
              eval_best, eval_played, cpl, wpd, best_uci, depth, book_line, sigma_type
         FROM move_stockfish_analysis
        WHERE game_source = $1 AND game_id = $2
        ORDER BY ply ASC`,
      [gameSource, gameId],
    );

    return res.json({
      ...base,
      analysis: {
        accuracyWhite: row.accuracy_white,
        accuracyBlack: row.accuracy_black,
        openingName: row.opening_name,
        ecoCode: row.eco_code,
        gameClassification: row.game_classification,
        analysisDepth: row.analysis_depth,
        engineVersion: row.engine_version,
        ...(row.result || {}),
      },
      moves: movesRes.rows,
    });
  } catch (err) {
    console.error('getAnalysis error:', err);
    res.status(500).json({ message: 'Failed to load game analysis', error: err.message });
  }
}

/**
 * POST /api/analysis/games/:gameSource/:gameId
 *
 * Queue it now, or re-run it. Idempotent: enqueueing a queued game reports
 * 'already_queued' rather than starting a second analysis of the same game.
 *
 * A game that is already DONE is NOT re-analysed by default — the stored result
 * is current, and silently re-running an expensive job behind a click is a worse
 * answer than saying so. `?force=1` re-runs it, which is what "Analyse again"
 * uses after an engine upgrade or a failed attempt.
 */
async function requestAnalysis(req, res) {
  const v = validate(req, res);
  if (!v) return;
  const { gameSource, gameId } = v;
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    if (!(await mayRead(gameSource, gameId, req.user))) {
      return res.status(404).json({ message: 'Game not found' });
    }

    /* The game must exist and be loadable. Enqueueing an id that names nothing
       would only create a job that can never succeed. */
    const loaded = await loadGame(gameSource, gameId);
    if (!loaded.ok) {
      return res.status(422).json({ message: 'This game cannot be analysed', reason: loaded.reason });
    }
    const { game } = loaded;

    const current = await db.query(
      'SELECT status FROM game_stockfish_analysis WHERE game_source = $1 AND game_id = $2',
      [gameSource, gameId],
    );
    const existing = current.rows.length ? current.rows[0].status : null;

    if (existing === 'done') {
      if (!force) {
        return res.json({ status: 'done', requeued: false, jobId: jobIdFor(gameSource, gameId) });
      }
      const r = await requeueGame({ gameSource, gameId });
      return res.json({ status: 'pending', requeued: r.requeued, forced: true, jobId: jobIdFor(gameSource, gameId) });
    }

    /* Already in flight: no second lease, no attempt counter reset. Reporting
       the real status is the whole answer. */
    if (existing === 'pending' || existing === 'processing') {
      return res.json({ status: existing, requeued: false, jobId: jobIdFor(gameSource, gameId) });
    }

    const enq = await enqueueGame({
      gameSource,
      gameId,
      ownerUserId: game.ownerUserId,
      pgn: game.pgn,
      movesCount: game.movesCount,
      force,
    });
    return res.status(enq.queued ? 202 : 200).json({
      status: enq.queued ? 'pending' : 'absent',
      queued: enq.queued,
      reason: enq.reason,
      jobId: enq.jobId || jobIdFor(gameSource, gameId),
    });
  } catch (err) {
    console.error('requestAnalysis error:', err);
    res.status(500).json({ message: 'Failed to queue game analysis', error: err.message });
  }
}

/**
 * GET /api/analysis/queue — admin only. Queue health, so an operator can tell
 * "the worker is down" (pending climbing, nothing processing) from "the engine
 * is wedged" (processing stuck on one job) from "one bad game" (a single failed
 * row with a message).
 */
async function getQueueStats(req, res) {
  try {
    res.json(await queueStats());
  } catch (err) {
    console.error('getQueueStats error:', err);
    res.status(500).json({ message: 'Failed to load queue stats', error: err.message });
  }
}

/** GET /api/analysis/stuck — admin only. Claims whose lease has expired. */
async function getStuckJobs(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT game_source, game_id, eligibility, attempts, requested_at, lease_expires_at
         FROM game_stockfish_analysis
        WHERE status = 'processing' AND lease_expires_at < NOW()
        ORDER BY lease_expires_at ASC
        LIMIT 100`,
    );
    res.json({ stuck: rows });
  } catch (err) {
    console.error('getStuckJobs error:', err);
    res.status(500).json({ message: 'Failed to load stuck jobs', error: err.message });
  }
}

module.exports = {
  GAME_SOURCES,
  RETRY_AFTER,
  getAnalysis,
  requestAnalysis,
  getQueueStats,
  getStuckJobs,
  mayRead,
};
