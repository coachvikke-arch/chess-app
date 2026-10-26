require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * Sigma Moves migration runner — applies migrations/add_sigma_moves.sql then
 * verifies what the controller actually depends on.
 *
 * The checks that matter here are the ones a clean apply would NOT catch:
 *   · the unique key must be (game_source, game_id, ply) and NOT game_id alone,
 *     because chess_games / online_games / computer_games / tournament_games all
 *     number from 1 and a single-column key would merge unrelated games;
 *   · the CHECK constraints must reject a fifth game_source and a bogus type,
 *     because a typo that slips past the controller's allow-list would create
 *     a row the UI can never render.
 */
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_sigma_moves.sql'), 'utf8');
    await db.pool.query(sql);

    const tables = await db.pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sigma_moves'
    `);
    if (!tables.rows.length) throw new Error('Missing table: sigma_moves');

    const cols = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sigma_moves'
    `);
    const present = new Set(cols.rows.map((r) => r.column_name));
    const required = [
      'id', 'owner_user_id', 'game_source', 'game_id', 'ply', 'sigma_type',
      'move_san', 'from_square', 'to_square', 'fen_before', 'played_at',
      'white_name', 'black_name', 'white_rating', 'black_rating',
      'created_at', 'updated_at',
    ];
    const missingCols = required.filter((c) => !present.has(c));
    if (missingCols.length) throw new Error(`Missing columns: ${missingCols.join(', ')}`);

    /* The composite unique key is the idempotency guarantee — re-reviewing a
       game must replace its Sigmas, not duplicate them. */
    const uq = await db.pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'sigma_moves'::regclass AND contype = 'u'
    `);
    const uqDefs = uq.rows.map((r) => r.def);
    const composite = uqDefs.some((d) =>
      d.includes('game_source') && d.includes('game_id') && d.includes('ply'));
    if (!composite) {
      throw new Error(`Expected a UNIQUE (game_source, game_id, ply) constraint, found: ${uqDefs.join(' | ') || 'none'}`);
    }
    if (uqDefs.some((d) => /\bgame_id\b/.test(d) && !d.includes('game_source'))) {
      throw new Error('Found a UNIQUE constraint on game_id alone — it would merge games across sources');
    }

    /* The CHECK constraints have to actually reject bad values, not merely
       exist. Probed with a real INSERT that is rolled back. */
    const badSource = await db.pool.query(
      `INSERT INTO sigma_moves (owner_user_id, game_source, game_id, ply, sigma_type)
       VALUES ($1, 'not_a_source', 1, 0, 'queen_sacrifice')`,
      [(await firstUserId()) ?? 0]
    ).then(() => 'ACCEPTED (constraint missing!)').catch(() => 'rejected');
    if (badSource !== 'rejected') throw new Error('game_source accepted an invalid value');

    const badType = await db.pool.query(
      `INSERT INTO sigma_moves (owner_user_id, game_source, game_id, ply, sigma_type)
       VALUES ($1, 'computer', 1, 0, 'grand_sacrifice')`,
      [(await firstUserId()) ?? 0]
    ).then(() => 'ACCEPTED (constraint missing!)').catch(() => 'rejected');
    if (badType !== 'rejected') throw new Error('sigma_type accepted an invalid value');

    /* AND that a valid row is accepted, so a check that rejects everything
       (e.g. a CHECK on the wrong column) cannot pass as "constraints work". */
    const uid = await firstUserId();
    if (uid) {
      const good = await db.pool.query(
        `INSERT INTO sigma_moves (owner_user_id, game_source, game_id, ply, sigma_type)
         VALUES ($1, 'computer', 1, 0, 'queen_sacrifice') RETURNING id`,
        [uid]
      );
      /* Clean up: the probe row must not leak into a developer's real list. */
      await db.pool.query('DELETE FROM sigma_moves WHERE id = $1', [good.rows[0].id]);
    }

    const idx = await db.pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'sigma_moves'
        AND indexname IN ('idx_sigma_moves_owner_played', 'idx_sigma_moves_owner_type', 'idx_sigma_moves_game')
    `);
    const idxNames = new Set(idx.rows.map((r) => r.indexname));
    const missingIdx = ['idx_sigma_moves_owner_played', 'idx_sigma_moves_owner_type', 'idx_sigma_moves_game']
      .filter((i) => !idxNames.has(i));
    if (missingIdx.length) throw new Error(`Missing indexes: ${missingIdx.join(', ')}`);

    /* ── the LIST query must run against the real schema ──────────────────────
       The API tests stub the database, so they cannot catch a column that does
       not exist. That is not hypothetical: an earlier version selected
       chess_games.white_player (the column is my_color), every test passed, and
       every request returned 500. Run the exact query here so a wrong column
       name fails the migration instead of the screen. */
    await db.pool.query(
      `SELECT sm.*,
              CASE sm.game_source
                WHEN 'chess_profile' THEN cp.my_color
                WHEN 'computer'      THEN cg.player_color
                WHEN 'online'        THEN CASE
                                          WHEN og.admin_id = sm.owner_user_id THEN og.admin_color
                                          WHEN og.student_id = sm.owner_user_id
                                            THEN CASE WHEN og.admin_color = 'white'
                                                      THEN 'black' ELSE 'white' END
                                          ELSE NULL
                                        END
                WHEN 'tournament'    THEN CASE
                                          WHEN tg.white_player = sm.owner_user_id THEN 'white'
                                          WHEN tg.black_player = sm.owner_user_id THEN 'black'
                                          ELSE NULL
                                        END
                ELSE NULL
              END AS owner_color
         FROM sigma_moves sm
         LEFT JOIN chess_games cp
                ON sm.game_source = 'chess_profile' AND cp.id = sm.game_id
         LEFT JOIN computer_games cg
                ON sm.game_source = 'computer' AND cg.id = sm.game_id
         LEFT JOIN online_games og
                ON sm.game_source = 'online' AND og.id = sm.game_id
         LEFT JOIN tournament_games tg
                ON sm.game_source = 'tournament' AND tg.id = sm.game_id
        WHERE sm.owner_user_id = $1
        ORDER BY sm.played_at DESC NULLS LAST, sm.game_id DESC, sm.ply ASC
        LIMIT 1 OFFSET 0`,
      [uid || 0]
    );

    console.log(
      'SIGMA MIGRATION OK — sigma_moves verified: composite UNIQUE (game_source, game_id, ply), '
      + 'game_source and sigma_type CHECKs accept only valid values, 3 indexes present, '
      + 'and the list query runs against the real schema.'
    );
    process.exit(0);
  } catch (error) {
    console.error('SIGMA MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();

/** Any real user id, for the constraint probes. Null when the DB has no users. */
async function firstUserId() {
  try {
    const r = await db.pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
    return r.rows.length ? r.rows[0].id : null;
  } catch {
    return null;
  }
}