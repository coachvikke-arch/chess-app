/**
 * Reset the RATED GAME system to a fresh state.
 *
 * Run:  node scripts/reset_rated_games.js --dry-run     (report only, changes nothing)
 *       node scripts/reset_rated_games.js               (perform the reset)
 *
 * GOAL: the application behaves as if no rated chess game has ever been played.
 *
 * ── WHAT COUNTS AS A "RATED GAME" ────────────────────────────────────────────
 * `online_games` has no `rated` column, so rated-ness is DERIVED, never assumed.
 * The authoritative marker is the rating record a game produced:
 *
 *     a game is rated  <=>  it has rows in rating_history
 *                            or time_control_rating_history
 *                            with online_game_id = online_games.id
 *
 * That is exactly what ratingService writes for a rated game, so it cannot
 * disagree with the application. Every non-rated game - bot games, abandoned
 * matches, practice games where a coach had no student row - fails the test and
 * is therefore KEPT.
 *
 * ── THE FRESH-PLAYER DEFAULT IS NOT HARDCODED ────────────────────────────────
 * A fresh student is created by authController as:
 *
 *     INSERT INTO students (user_id, nickname, birthdate, ...) VALUES (...)
 *
 * - no rating column is ever named, so the fresh state IS the column default
 * declared in the schema. This script READS those defaults out of
 * information_schema and restores exactly them, so the reset can never drift
 * away from the application's real initial state.
 *
 * The per-time-control pools are DELETED rather than zeroed, because that is
 * genuinely what a fresh player has: ratingService.getTimeRating creates a pool
 * lazily, at STARTING_RATING (ratingService.js), the first time somebody plays
 * that control. buildProfile already renders a missing pool as "unrated"
 * (rating: null), so no UI breaks.
 *
 * ── WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────
 *   students / users / classes / tournaments / puzzles / assignments / academy /
 *   chat / attendance / openings / lessons ... never touched.
 *   chess_games + chess_ratings + chess_rating_history - a SEPARATE rating system
 *     for synced Chess.com/Lichess games, unrelated to in-app rated play.
 *   computer_games, bot_game_results, bot_progress, bot_rewards - unrated play.
 *   gm_games, move_stockfish_analysis, sigma_moves, imported_game_analysis -
 *     analysis/import features, not rated games.
 *   certificates and student_game_analysis - kept by explicit instruction.
 *     NOTE: certificates are issued 1:1 with student_levels rows, so once the
 *     level records go a student will be re-issued a duplicate certificate for a
 *     level they already hold. Accepted trade-off, see the run report.
 *
 * Everything runs in ONE transaction: either the whole reset applies, or none of
 * it does. A full pg_dump backup is recommended before running.
 */
const db = require('../src/config/database');

const DRY_RUN = process.argv.includes('--dry-run');

/* Columns of `students` that belong to the rated system, and nothing else.
   Anything not listed here (nickname, birthdate, coach_id, ...) is left alone. */
const STUDENT_RATING_COLUMNS = [
  'current_rating',
  'peak_rating',
  'highest_level',
  'games_played',
  'provisional_games',
  'last_rating_change_at',
];

/** Read the schema's declared defaults so the reset restores the real ones. */
async function studentDefaults() {
  const r = await db.query(
    `SELECT column_name, column_default, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'students'
        AND column_name = ANY($1)`,
    [STUDENT_RATING_COLUMNS],
  );
  const out = {};
  for (const row of r.rows) {
    if (row.column_name === 'last_rating_change_at') { out[row.column_name] = null; continue; }
    if (row.column_default === null) throw new Error(`${row.column_name} has no schema default - refusing to guess`);
    out[row.column_name] = Number(row.column_default);
  }
  const missing = STUDENT_RATING_COLUMNS.filter((c) => !(c in out));
  if (missing.length) throw new Error(`missing defaults for: ${missing.join(', ')}`);
  return out;
}

async function ratedGameIds(client) {
  const r = await client.query(
    `SELECT DISTINCT g.id
       FROM online_games g
      WHERE EXISTS (SELECT 1 FROM rating_history h WHERE h.online_game_id = g.id)
         OR EXISTS (SELECT 1 FROM time_control_rating_history t WHERE t.online_game_id = g.id)
      ORDER BY g.id`,
  );
  return r.rows.map((x) => x.id);
}

async function count(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0].n;
}

async function main() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const defaults = await studentDefaults();
    const ratedIds = await ratedGameIds(client);

    console.log('='.repeat(72));
    console.log(DRY_RUN ? 'DRY RUN - nothing will be changed' : 'RESET RATED GAMES');
    console.log('='.repeat(72));
    console.log('\nFresh-player defaults read from the schema (not hardcoded):');
    for (const [k, v] of Object.entries(defaults)) {
      console.log(`   students.${k.padEnd(22)} -> ${v === null ? 'NULL' : v}`);
    }
    console.log(`\nRated games identified from rating records: ${ratedIds.length}`);
    console.log(`   ids: ${ratedIds.length ? ratedIds.join(', ') : '(none)'}`);

    /* ── pre-flight counts ───────────────────────────────────────────────── */
    const plan = [];
    const add = async (label, sql, params = []) => {
      const n = await count(client, sql, params);
      plan.push({ label, n, sql, params });
      return n;
    };

    console.log('\nWILL DELETE / RESET:');
    await add('rating_history rows (all - fresh start)',
      'SELECT count(*)::int n FROM rating_history');
    await add('time_control_rating_history rows (all - fresh start)',
      'SELECT count(*)::int n FROM time_control_rating_history');
    await add('student_time_ratings pools (fresh player has none; recreated at STARTING_RATING)',
      'SELECT count(*)::int n FROM student_time_ratings');
    await add('student_levels tier/badge records (fresh player has none)',
      'SELECT count(*)::int n FROM student_levels');
    await add('online_games that were RATED',
      'SELECT count(*)::int n FROM online_games WHERE id = ANY($1)', [ratedIds]);
    await add('game_stockfish_analysis rows for rated games',
      `SELECT count(*)::int n FROM game_stockfish_analysis
        WHERE game_source = 'online' AND game_id = ANY($1)`, [ratedIds]);
    await add('notifications tied to rated games',
      `SELECT count(*)::int n FROM notifications
        WHERE related_id = ANY($1)
          AND type IN ('game_result','game_finished','match_request','game_invite')`, [ratedIds]);
    await add('students rating columns to restore to defaults',
      'SELECT count(*)::int n FROM students');

    const deletedTotal = plan.reduce((a, p) => a + p.n, 0);
    for (const p of plan) console.log(`   ${String(p.n).padStart(5)}  ${p.label}`);

    /* ── explicit keep list, so "what survived" is provable ──────────────── */
    console.log('\nWILL BE KEPT (verified unrelated to the rated system):');
    const keeps = [
      ['online_games that were NOT rated (bot / abandoned / practice)', 'SELECT count(*)::int n FROM online_games WHERE id <> ALL($1)', [ratedIds]],
      ['computer_games (vs Stockfish, unrated)', 'SELECT count(*)::int n FROM computer_games', []],
      ['bot_game_results / bot_progress / bot_rewards', `SELECT (SELECT count(*)::int FROM bot_game_results)
        + (SELECT count(*)::int FROM bot_progress) + (SELECT count(*)::int FROM bot_rewards) AS n`, []],
      ['chess_games (synced Chess.com/Lichess - separate rating system)', 'SELECT count(*)::int n FROM chess_games', []],
      ['chess_ratings + chess_rating_history (external platform ratings)', `SELECT (SELECT count(*)::int FROM chess_ratings)
        + (SELECT count(*)::int FROM chess_rating_history) AS n`, []],
      ['students (rows kept; only their rating COLUMNS are reset)', 'SELECT count(*)::int n FROM students', []],
      ['users (untouched)', 'SELECT count(*)::int n FROM users', []],
      ['certificates (kept by instruction)', 'SELECT count(*)::int n FROM certificates', []],
      ['student_game_analysis rollups (kept by instruction)', 'SELECT count(*)::int n FROM student_game_analysis', []],
      ['classes / class_students', `SELECT (SELECT count(*)::int FROM classes)
        + (SELECT count(*)::int FROM class_students) AS n`, []],
      ['puzzles / assignments / academy / chat', `SELECT (SELECT count(*)::int FROM puzzles)
        + (SELECT count(*)::int FROM assignments) + (SELECT count(*)::int FROM academy_progress)
        + (SELECT count(*)::int FROM chat_messages) AS n`, []],
      ['gm_games + analysis tables', `SELECT (SELECT count(*)::int FROM gm_games)
        + (SELECT count(*)::int FROM move_stockfish_analysis)
        + (SELECT count(*)::int FROM imported_game_analysis) AS n`, []],
    ];
    for (const [label, sql, params] of keeps) {
      const n = await count(client, sql, params);
      console.log(`   ${String(n).padStart(5)}  ${label}`);
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n--- DRY RUN complete. No data was changed. ---');
      return;
    }

    /* ── perform ─────────────────────────────────────────────────────────── */
    /* History first, then the games, so nothing transiently dangles. */
    await client.query('DELETE FROM time_control_rating_history');
    await client.query('DELETE FROM rating_history');
    /* Pools and tier records go: both are created lazily on the first rated
       game, so their absence is the genuine fresh state. */
    await client.query('DELETE FROM student_time_ratings');
    await client.query('DELETE FROM student_levels');

    if (ratedIds.length) {
      await client.query(
        `DELETE FROM game_stockfish_analysis
          WHERE game_source = 'online' AND game_id = ANY($1)`, [ratedIds],
      );
      await client.query(
        `DELETE FROM notifications
          WHERE related_id = ANY($1)
            AND type IN ('game_result','game_finished','match_request','game_invite')`, [ratedIds],
      );
      await client.query('DELETE FROM online_games WHERE id = ANY($1)', [ratedIds]);
    }

    /* Restore the schema defaults. Written from the values read above so this
       can never introduce a value the application does not itself use. */
    await client.query(
      `UPDATE students SET
         current_rating = $1, peak_rating = $2, highest_level = $3,
         games_played = $4, provisional_games = $5, last_rating_change_at = $6`,
      [defaults.current_rating, defaults.peak_rating, defaults.highest_level,
        defaults.games_played, defaults.provisional_games, defaults.last_rating_change_at],
    );

    /* ── verify inside the same transaction, before committing ───────────── */
    const after = {
      rating_history: await count(client, 'SELECT count(*)::int n FROM rating_history'),
      time_control_rating_history: await count(client, 'SELECT count(*)::int n FROM time_control_rating_history'),
      student_time_ratings: await count(client, 'SELECT count(*)::int n FROM student_time_ratings'),
      student_levels: await count(client, 'SELECT count(*)::int n FROM student_levels'),
      rated_games: await count(client,
        `SELECT count(*)::int n FROM online_games g
          WHERE EXISTS (SELECT 1 FROM rating_history h WHERE h.online_game_id = g.id)
             OR EXISTS (SELECT 1 FROM time_control_rating_history t WHERE t.online_game_id = g.id)`),
      kept_games: await count(client, 'SELECT count(*)::int n FROM online_games'),
    };
    const offSchema = await client.query(
      `SELECT count(*)::int n FROM students
        WHERE current_rating <> $1 OR peak_rating <> $2 OR highest_level <> $3
           OR games_played <> 0 OR provisional_games <> 0
           OR last_rating_change_at IS NOT NULL`,
      [defaults.current_rating, defaults.peak_rating, defaults.highest_level],
    );

    console.log('\nAFTER (inside the transaction):');
    for (const [k, v] of Object.entries(after)) console.log(`   ${String(v).padStart(5)}  ${k}`);
    console.log(`   ${String(offSchema.rows[0].n).padStart(5)}  students not at schema defaults (must be 0)`);

    const problems = [];
    for (const k of ['rating_history', 'time_control_rating_history', 'student_time_ratings', 'student_levels', 'rated_games']) {
      if (after[k] !== 0) problems.push(`${k} is ${after[k]}, expected 0`);
    }
    if (offSchema.rows[0].n !== 0) problems.push(`${offSchema.rows[0].n} student(s) not at schema defaults`);

    if (problems.length) {
      await client.query('ROLLBACK');
      console.error('\nVERIFICATION FAILED - rolled back, nothing was changed:');
      for (const p of problems) console.error(`   - ${p}`);
      process.exitCode = 1;
      return;
    }

    await client.query('COMMIT');
    console.log('\nCOMMITTED. The rated system is in a fresh state.');
    console.log(`Total rows removed/reset: ${deletedTotal}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('reset failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });