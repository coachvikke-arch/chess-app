/* Backfill ratings for tournament games that finished while the rating bridge
 * was not yet in place (`rating_status = 'pending'`).
 *
 *   node scripts/backfill_tournament_ratings.js            ← dry run, writes nothing
 *   node scripts/backfill_tournament_ratings.js --apply    ← commits the settlements
 *
 * Every game is settled through the same `settleFinishedGame` used at game
 * finish, so the exactly-once guard, the abandon/Armageddon skips and the
 * student-profile requirement all apply identically. Games are processed oldest
 * first so each player's rating progression matches the original order.
 *
 * The dry run opens a transaction, settles every game inside it and rolls back,
 * which also means the locks and the partial UNIQUE indexes are exercised.
 */
'use strict';
require('dotenv').config();
const db = require('../src/config/database');
const TR = require('../src/services/tournamentRatingService');

const APPLY = process.argv.includes('--apply');

(async () => {
  await TR.ensureSchema();

  const games = (await db.query(
    `SELECT id, tournament_id, result, armageddon, finished_at
       FROM tournament_games
      WHERE status = 'finished' AND rating_status = 'pending'
      ORDER BY finished_at ASC NULLS LAST, id ASC`,
  )).rows;

  if (games.length === 0) {
    console.log('No pending finished tournament games — nothing to backfill.');
    await db.pool.end();
    return;
  }

  const tournaments = new Map();
  const loadTournament = async (id) => {
    if (!tournaments.has(id)) {
      const row = (await db.query('SELECT * FROM tournaments WHERE id = $1', [id])).rows[0] || null;
      tournaments.set(id, row);
    }
    return tournaments.get(id);
  };

  const counts = { applied: 0, skipped: 0, noop: 0 };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const g of games) {
      const tournament = await loadTournament(g.tournament_id);
      if (!tournament) {
        console.log(`  game ${g.id}: tournament ${g.tournament_id} is gone — skipped`);
        counts.skipped += 1;
        continue;
      }
      const out = await TR.settleFinishedGame(client, {
        game: { id: g.id },
        tournament,
        result: g.result,
      });
      if (out.alreadyApplied) {
        counts.noop += 1;
        console.log(`  game ${g.id}: already applied — no-op`);
      } else if (out.skipped) {
        counts.skipped += 1;
        console.log(`  game ${g.id}: skipped (${out.skipped})`);
      } else {
        counts.applied += 1;
        console.log(`  game ${g.id} (tournament ${tournament.name}): rated as ${g.result}`);
      }
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\nCommitted: ${counts.applied} rated, ${counts.skipped} skipped, ${counts.noop} already applied.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\nDry run: ${counts.applied} game(s) WOULD be rated, ${counts.skipped} skipped, ${counts.noop} already applied.`);
      console.log('Nothing was written. Re-run with --apply to commit.');
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  await db.pool.end();
})().catch(async (err) => {
  console.error('BACKFILL FAILED:', err.message);
  process.exitCode = 1;
  try { await db.pool.end(); } catch (_) { /* ignore */ }
});
