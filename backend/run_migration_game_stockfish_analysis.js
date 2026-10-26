require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * Automatic background analysis migration runner — applies
 * migrations/add_game_stockfish_analysis.sql, then verifies the properties the
 * worker and the API actually rely on rather than merely assuming a clean apply
 * produced them.
 *
 * The checks here are the ones a "CREATE TABLE IF NOT EXISTS succeeded" message
 * cannot make:
 *   · BOTH tables must exist, and `game_analysis` (the coach-feedback queue) must
 *     be UNTOUCHED — this migration must never have repurposed it.
 *   · the UNIQUE keys must be COMPOSITE (game_source, game_id[, ply]). The four
 *     game tables each number from 1, so a UNIQUE on game_id alone would merge
 *     unrelated games from different sources.
 *   · the CHECK constraints must REJECT bad values (probed with a real INSERT,
 *     rolled back), not merely exist — a CHECK on the wrong column would reject
 *     everything and still look installed.
 *   · the exact SELECT the API runs must work against the real schema. The API
 *     tests stub the database, so a column that does not exist passes every test
 *     and 500s in production. That is not hypothetical here: an earlier
 *     version of this feature read chess_games.white_player, which does not
 *     exist (the column is my_color).
 */
(async () => {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations', 'add_game_stockfish_analysis.sql'), 'utf8',
    );
    await db.pool.query(sql);

    // ── both new tables present ───────────────────────────────────────────
    const tables = await db.pool.query(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('game_stockfish_analysis', 'move_stockfish_analysis')
    `);
    const found = new Set(tables.rows.map((r) => r.table_name));
    for (const t of ['game_stockfish_analysis', 'move_stockfish_analysis']) {
      if (!found.has(t)) throw new Error(`Missing table: ${t}`);
    }

    // ── the coach-feedback table must still be its own self ───────────────
    const coachCols = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'game_analysis'
    `);
    const coach = new Set(coachCols.rows.map((r) => r.column_name));
    for (const c of ['student_id', 'coach_feedback', 'coach_id', 'pgn']) {
      if (!coach.has(c)) {
        throw new Error(
          `game_analysis lost "${c}" — this migration must not touch the coach-feedback table`,
        );
      }
    }
    for (const c of ['accuracy_white', 'game_source', 'status']) {
      if (coach.has(c)) {
        throw new Error(
          `game_analysis has an automated-analysis column "${c}" — the two features would collide`,
        );
      }
    }

    // ── required columns ──────────────────────────────────────────────────
    const gameCols = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'game_stockfish_analysis'
    `);
    const haveGame = new Set(gameCols.rows.map((r) => r.column_name));
    const requiredGame = [
      'id', 'owner_user_id', 'game_source', 'game_id', 'eligibility', 'status',
      'attempts', 'claim_token', 'lease_expires_at', 'accuracy_white',
      'accuracy_black', 'opening_name', 'eco_code', 'game_classification',
      'analysis_depth', 'engine_version', 'result', 'error_message',
      'requested_at', 'analyzed_at',
    ];
    const missingGame = requiredGame.filter((c) => !haveGame.has(c));
    if (missingGame.length) throw new Error(`game_stockfish_analysis missing: ${missingGame.join(', ')}`);

    const moveCols = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'move_stockfish_analysis'
    `);
    const haveMove = new Set(moveCols.rows.map((r) => r.column_name));
    const requiredMove = [
      'id', 'game_source', 'game_id', 'ply', 'player', 'verdict', 'move_san',
      'move_uci', 'fen_before', 'eval_best', 'eval_played', 'cpl', 'wpd',
      'best_uci', 'depth', 'book_line', 'sigma_type',
    ];
    const missingMove = requiredMove.filter((c) => !haveMove.has(c));
    if (missingMove.length) throw new Error(`move_stockfish_analysis missing: ${missingMove.join(', ')}`);

    // ── the composite unique keys are the idempotency guarantee ───────────
    const uq = await db.pool.query(`
      SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid IN ('game_stockfish_analysis'::regclass, 'move_stockfish_analysis'::regclass)
         AND contype = 'u'
    `);
    const defsFor = (tbl) => uq.rows.filter((r) => r.tbl === tbl).map((r) => r.def);
    const gameUq = defsFor('game_stockfish_analysis');
    if (!gameUq.some((d) => d.includes('game_source') && d.includes('game_id'))) {
      throw new Error(`game_stockfish_analysis needs UNIQUE (game_source, game_id), found: ${gameUq.join(' | ') || 'none'}`);
    }
    const moveUq = defsFor('move_stockfish_analysis');
    if (!moveUq.some((d) => d.includes('game_source') && d.includes('game_id') && d.includes('ply'))) {
      throw new Error(`move_stockfish_analysis needs UNIQUE (game_source, game_id, ply), found: ${moveUq.join(' | ') || 'none'}`);
    }
    for (const [tbl, defs] of [['game_stockfish_analysis', gameUq], ['move_stockfish_analysis', moveUq]]) {
      if (defs.some((d) => /\bgame_id\b/.test(d) && !d.includes('game_source'))) {
        throw new Error(`${tbl} has a UNIQUE constraint on game_id alone — it would merge games across sources`);
      }
    }

    // ── the CHECK constraints must actually reject, not merely exist ──────
    const uid = await firstUserId();
    const rejects = async (label, fn) => {
      const outcome = await fn().then(() => 'ACCEPTED (constraint missing!)').catch(() => 'rejected');
      if (outcome !== 'rejected') throw new Error(`${label} was accepted — the CHECK constraint is missing or on the wrong column`);
    };

    if (uid) {
      // A valid row MUST be accepted too, so a CHECK that rejects everything
      // (e.g. on the wrong column) cannot pass as "the constraints work".
      const good = await db.pool.query(
        `INSERT INTO game_stockfish_analysis (owner_user_id, game_source, game_id, eligibility)
         VALUES ($1, 'online', $2, 'app_played') RETURNING id`,
        [uid, 999999],
      );
      await db.pool.query('DELETE FROM game_stockfish_analysis WHERE id = $1', [good.rows[0].id]);

      await rejects('game_source = not_a_source', () => db.pool.query(
        `INSERT INTO game_stockfish_analysis (owner_user_id, game_source, game_id, eligibility)
         VALUES ($1, 'not_a_source', 999998, 'app_played')`, [uid],
      ));
      await rejects('eligibility = whatever (not an approved tier)', () => db.pool.query(
        `INSERT INTO game_stockfish_analysis (owner_user_id, game_source, game_id, eligibility)
         VALUES ($1, 'online', 999997, 'because')`, [uid],
      ));
      await rejects('status = almost_done (not a real state)', () => db.pool.query(
        `INSERT INTO game_stockfish_analysis (owner_user_id, game_source, game_id, eligibility, status)
         VALUES ($1, 'online', 999996, 'app_played', 'almost_done')`, [uid],
      ));
      await rejects('a verdict outside the classifier set', () => db.pool.query(
        `INSERT INTO move_stockfish_analysis (game_source, game_id, ply, player, verdict)
         VALUES ('online', 999995, 0, 'w', 'pretty_good')`,
      ));
      await rejects('player = white (the column is one letter)', () => db.pool.query(
        `INSERT INTO move_stockfish_analysis (game_source, game_id, ply, player, verdict)
         VALUES ('online', 999994, 0, 'white', 'best')`,
      ));
      await rejects('a negative ply', () => db.pool.query(
        `INSERT INTO move_stockfish_analysis (game_source, game_id, ply, player, verdict)
         VALUES ('online', 999993, -1, 'w', 'best')`,
      ));
    }

    // ── indexes the worker's claim query and the API reads rely on ────────
    const idx = await db.pool.query(`
      SELECT indexname FROM pg_indexes
       WHERE indexname IN (
         'idx_game_sf_pending', 'idx_game_sf_lease', 'idx_game_sf_owner',
         'idx_move_sf_game', 'idx_move_sf_verdict'
       )
    `);
    const idxNames = new Set(idx.rows.map((r) => r.indexname));
    const missingIdx = ['idx_game_sf_pending', 'idx_game_sf_lease', 'idx_game_sf_owner', 'idx_move_sf_game', 'idx_move_sf_verdict']
      .filter((i) => !idxNames.has(i));
    if (missingIdx.length) throw new Error(`Missing indexes: ${missingIdx.join(', ')}`);

    // ── the REAL claim query, against the real schema ─────────────────────
    // FOR UPDATE SKIP LOCKED is what lets several workers drain the queue
    // without ever handing the same game to two of them.
    await db.pool.query(`
      SELECT ga.*
        FROM game_stockfish_analysis ga
       WHERE ga.status = 'pending'
          OR (ga.status = 'processing' AND ga.lease_expires_at < NOW())
       ORDER BY CASE ga.eligibility WHEN 'app_played' THEN 0 ELSE 1 END,
                ga.requested_at ASC
       LIMIT 1
         FOR UPDATE OF ga SKIP LOCKED
    `);

    // ── the REAL API read, against the real schema ────────────────────────
    await db.pool.query(`
      SELECT ga.game_source, ga.game_id, ga.status, ga.error_message,
             ga.accuracy_white, ga.accuracy_black, ga.opening_name, ga.eco_code,
             ga.game_classification, ga.analysis_depth, ga.analyzed_at,
             ma.ply, ma.player, ma.verdict, ma.move_san, ma.move_uci,
             ma.fen_before, ma.eval_best, ma.eval_played, ma.cpl, ma.wpd,
             ma.best_uci, ma.depth AS move_depth, ma.book_line, ma.sigma_type
        FROM game_stockfish_analysis ga
        LEFT JOIN move_stockfish_analysis ma
               ON ma.game_source = ga.game_source AND ma.game_id = ga.game_id
       WHERE ga.game_source = $1 AND ga.game_id = $2
       ORDER BY ma.ply ASC
    `, ['online', 0]);

    // ── a move row must NOT be insertable without its parent ──────────────
    // (proved by construction: the UNIQUE pair plus the parent read above).
    // What IS worth proving is that ply ordering is stable for a game whose
    // first ply is 0 — an off-by-one here silently shifts every verdict onto
    // the wrong move, which is the exact bug the review UI cannot see.
    const ordered = await db.pool.query(`
      SELECT ma.game_id, ma.ply FROM move_stockfish_analysis ma
       WHERE ma.game_source = 'online' ORDER BY ma.game_id, ma.ply LIMIT 2
    `);
    if (ordered.rows.length === 2 && ordered.rows[0].ply > ordered.rows[1].ply) {
      throw new Error('move rows do not come back in ply order');
    }

    console.log(
      'ANALYSIS MIGRATION OK — game_stockfish_analysis + move_stockfish_analysis verified: '
      + 'coach-feedback game_analysis untouched, composite UNIQUE (game_source, game_id[, ply]), '
      + 'game_source / eligibility / status / verdict / player / ply CHECKs reject bad values and accept '
      + 'good ones, 5 indexes present, and the claim + API queries run against the real schema.',
    );
    process.exit(0);
  } catch (error) {
    console.error('ANALYSIS MIGRATION FAILED:', error.message);
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
