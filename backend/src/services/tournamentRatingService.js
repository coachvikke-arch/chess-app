'use strict';

/**
 * Tournament ⇄ rating bridge.
 *
 * The Elo maths lives in `ratingService` and is NOT reimplemented here. This
 * module only answers the tournament-specific questions:
 *
 *   · which user ids are the two rated students (`tournament_registrations`
 *     stores USER ids, while `rating_history` and `students` use STUDENT ids),
 *   · is this game eligible to be rated (a real result, not an Armageddon
 *     tiebreak, not an abandon, both players have a student profile),
 *   · where to record the settlement (`tournament_games.rating_status` and the
 *     `tournament_game_id` link on both rating-history tables),
 *   · how to reverse a settlement safely when an admin corrects a result.
 *
 * Everything runs on a caller-owned transaction (`client`), so the pairing
 * result and the rating movement commit together. See
 * `ratingService.applyGameResultInTransaction` for the exactly-once guard.
 */

const db = require('../config/database');
const rating = require('./ratingService');

/* Results that are officially completed games. 'abandon' deliberately is not
   here: an abandoned board is void, exactly like the online policy. */
const RATEABLE_RESULTS = ['white', 'black', 'draw'];

let schemaReady = null;

/* Idempotent DDL, mirroring migrations/add_tournament_rating.sql.
 *
 * It is awaited lazily instead of at module load because the rating tables are
 * installed by their own migration, not by schema.sql. If the rating subsystem
 * is absent this resolves to `false` and settlement is skipped rather than
 * breaking the tournament result. */
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = runSchema().catch((err) => {
      schemaReady = null; // allow a retry on the next call
      throw err;
    });
  }
  return schemaReady;
}

async function runSchema() {
  const reg = await db.query(
    `SELECT to_regclass('public.rating_history') AS rh,
            to_regclass('public.time_control_rating_history') AS th,
            to_regclass('public.tournament_games') AS tg`,
  );
  const row = reg.rows[0];
  if (!row.tg) return false; // tournament feature not installed yet
  await db.query(`ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_status VARCHAR(16) NOT NULL DEFAULT 'pending'`);
  await db.query(`ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_result VARCHAR(16)`);
  await db.query(`ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_note TEXT`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tournament_games_rating_status ON tournament_games (rating_status)`);
  if (!row.rh) return false; // rating subsystem not installed

  await db.query(`ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS tournament_game_id INTEGER REFERENCES tournament_games(id) ON DELETE SET NULL`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_history_tournament_game
                    ON rating_history (tournament_game_id, student_id)
                    WHERE tournament_game_id IS NOT NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_rating_history_tournament_student
                    ON rating_history (student_id, tournament_game_id)`);

  if (row.th) {
    await db.query(`ALTER TABLE time_control_rating_history ADD COLUMN IF NOT EXISTS tournament_game_id INTEGER REFERENCES tournament_games(id) ON DELETE SET NULL`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tc_rating_history_tournament_game
                      ON time_control_rating_history (tournament_game_id, student_id)
                      WHERE tournament_game_id IS NOT NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_tc_rating_history_tournament_student
                      ON time_control_rating_history (student_id, tournament_game_id)`);
  }
  return true;
}

/** "10+5" — the same shape `ratingService.classifyTimeControl` understands. */
function timeControlOf(tournament) {
  const base = Number(tournament?.time_minutes) || 0;
  const inc = Number(tournament?.increment_seconds) || 0;
  return `${base}+${inc}`;
}

async function markGame(client, gameId, status, note, settledResult = undefined) {
  await client.query(
    `UPDATE tournament_games
        SET rating_status = $2, rated_at = NOW(), rating_note = $3,
            rating_result = CASE WHEN $4::text IS NULL THEN rating_result ELSE $4 END
      WHERE id = $1`,
    [gameId, status, note || null, settledResult ?? null],
  );
}

async function studentsForUsers(client, userIds) {
  const r = await client.query(
    `SELECT s.id, s.user_id, s.current_rating, u.name
       FROM students s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ANY($1)`,
    [userIds],
  );
  const byUser = {};
  for (const row of r.rows) byUser[Number(row.user_id)] = row;
  return byUser;
}

/**
 * Settle one finished tournament game.
 *
 * Call INSIDE the tournament transaction, after the pairing row was decided (or
 * in the knockout draw branch before the Armageddon board is created). The
 * function takes its own `FOR UPDATE` lock on the `tournament_games` row, so a
 * repeated call is a no-op instead of a second rating change.
 *
 * @param {object} client          pg client of the caller's transaction
 * @param {object} opts.game       { id } — the finished game
 * @param {object} opts.tournament the tournaments row (needs times for the pool)
 * @param {string} opts.result     the GAME result ('white' | 'black' | 'draw' | 'abandon')
 * @param {Array}  opts.after      post-commit queue from tournamentEngine.tx
 */
async function settleFinishedGame(client, { game, tournament, result, after = [] }) {
  const gameId = Number(game?.id);
  if (!Number.isInteger(gameId)) return { skipped: 'missing-game' };

  const row = (await client.query(
    `SELECT id, white_player, black_player, armageddon, rating_status
       FROM tournament_games WHERE id = $1 FOR UPDATE`,
    [gameId],
  )).rows[0];
  if (!row) return { skipped: 'missing-game' };
  if (row.rating_status === 'applied') return { alreadyApplied: true };

  if (row.armageddon) {
    await markGame(client, gameId, 'skipped', 'Armageddon tiebreak is not rated');
    return { skipped: 'armageddon' };
  }
  if (!RATEABLE_RESULTS.includes(result)) {
    await markGame(client, gameId, 'skipped', `Result "${result || 'none'}" is not rateable`);
    return { skipped: 'result' };
  }

  const whiteUserId = Number(row.white_player);
  const blackUserId = Number(row.black_player);
  if (!whiteUserId || !blackUserId) {
    await markGame(client, gameId, 'skipped', 'Game has no two players');
    return { skipped: 'players' };
  }

  const byUser = await studentsForUsers(client, [whiteUserId, blackUserId]);
  const white = byUser[whiteUserId];
  const black = byUser[blackUserId];
  /* A coach or an account without a `students` row has no Elo profile. The
     online path refuses to rate in the same situation; a tournament game must
     not invent a rating for them either. */
  if (!white || !black) {
    await markGame(client, gameId, 'skipped', 'Both players need a student rating profile');
    return { skipped: 'no-student' };
  }

  const scoreFor = (color) => (result === 'draw' ? 0.5 : result === color ? 1 : 0);
  const out = await rating.applyGameResultInTransaction(client, {
    player: {
      studentId: white.id,
      score: scoreFor('white'),
      rating: white.current_rating,
      name: white.name,
    },
    opponent: {
      studentId: black.id,
      score: scoreFor('black'),
      rating: black.current_rating,
      name: black.name,
    },
    meta: {
      gameType: 'tournament',
      timeControl: timeControlOf(tournament),
      tournamentGameId: gameId,
      rated: true,
    },
  });

  if (out.alreadyApplied) {
    await markGame(client, gameId, 'applied', 'Already settled', result);
    return out;
  }

  await markGame(client, gameId, 'applied', null, result);
  /* Certificates are issued after the commit — never under the player locks. */
  if (after && out.playerChange) after.push(() => rating.issueLevelCertificates(out));
  return out;
}

/**
 * Undo the rating movement recorded for one game.
 *
 * The recorded `rating_change` is subtracted from the CURRENT rating rather than
 * restoring the stored `rating_before`: other games may have been rated since,
 * and resetting to an old absolute number would erase them. `peak_rating` is
 * intentionally left alone — it is a monotonic "highest ever" by design.
 */
async function reverseGameSettlement(client, gameId, note) {
  const overall = await client.query(
    `SELECT student_id, rating_change FROM rating_history WHERE tournament_game_id = $1`,
    [gameId],
  );
  for (const row of overall.rows) {
    await client.query(
      `UPDATE students
          SET current_rating = GREATEST(100, current_rating - $2),
              games_played = GREATEST(0, games_played - 1),
              provisional_games = LEAST(20, provisional_games + 1),
              last_rating_change_at = NOW()
        WHERE id = $1`,
      [row.student_id, Number(row.rating_change) || 0],
    );
  }

  const pools = await client.query(
    `SELECT student_id, time_class, rating_change
       FROM time_control_rating_history WHERE tournament_game_id = $1`,
    [gameId],
  );
  for (const row of pools.rows) {
    await client.query(
      `UPDATE student_time_ratings
          SET rating = GREATEST(100, rating - $3),
              games_played = GREATEST(0, games_played - 1),
              provisional_games = LEAST(20, provisional_games + 1),
              last_changed_at = NOW(),
              updated_at = NOW()
        WHERE student_id = $1 AND time_class = $2`,
      [row.student_id, row.time_class, Number(row.rating_change) || 0],
    );
  }

  await client.query('DELETE FROM rating_history WHERE tournament_game_id = $1', [gameId]);
  await client.query('DELETE FROM time_control_rating_history WHERE tournament_game_id = $1', [gameId]);
  await markGame(client, gameId, 'reverted', note || 'Settlement reversed');
}

/**
 * Admin changed a pairing result. Reverse whatever was applied, then apply the
 * NEW result against the current ratings — in the same transaction, so a crash
 * cannot leave half a correction behind.
 *
 * If no settlement existed yet but the board already has a finished, rateable
 * game (an earlier settlement failure), the new result is applied now.
 */
async function correctPairingRating(client, { pairingId, tournament, newResult, after = [] }) {
  const rated = (await client.query(
    `SELECT * FROM tournament_games
      WHERE pairing_id = $1 AND rating_status = 'applied'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [pairingId],
  )).rows[0];

  if (rated) {
    /* Same result submitted again: the rating already reflects it. Do not
       reverse and re-apply (that could move the number if other games were
       rated in between, which is exactly the "repeated submission" trap). */
    if (rated.rating_result && rated.rating_result === newResult) return;
    await reverseGameSettlement(client, rated.id, 'Admin corrected the result');
    if (RATEABLE_RESULTS.includes(newResult) && !rated.armageddon) {
      await settleFinishedGame(client, {
        game: { id: rated.id }, tournament, result: newResult, after,
      });
    }
    return;
  }

  if (!RATEABLE_RESULTS.includes(newResult)) return;

  /* No prior settlement: settle the current finished board if it has a real
     result. An 'abandon' board is never turned into a rated game. */
  const game = (await client.query(
    `SELECT * FROM tournament_games
      WHERE pairing_id = $1 AND status = 'finished'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [pairingId],
  )).rows[0];
  if (!game || game.armageddon || !RATEABLE_RESULTS.includes(game.result)) return;
  await settleFinishedGame(client, {
    game: { id: game.id }, tournament, result: newResult, after,
  });
}

/** Revert (result = null) already applied a settlement for this pairing. */
async function revertPairingRating(client, pairingId) {
  const applied = await client.query(
    `SELECT id FROM tournament_games
      WHERE pairing_id = $1 AND rating_status = 'applied'
      ORDER BY id DESC`,
    [pairingId],
  );
  for (const row of applied.rows) {
    await reverseGameSettlement(client, row.id, 'Result reverted');
  }
}

module.exports = {
  ensureSchema,
  settleFinishedGame,
  correctPairingRating,
  revertPairingRating,
  timeControlOf,
  RATEABLE_RESULTS,
};
