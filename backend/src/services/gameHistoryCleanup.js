const db = require('../config/database');

const RETENTION_DAYS = (() => {
  const d = Number(process.env.GAME_HISTORY_RETENTION_DAYS);
  return Number.isFinite(d) && d >= 1 ? d : 7;
})();

const RUN_INTERVAL_MS = (() => {
  const d = Number(process.env.GAME_HISTORY_RUN_INTERVAL_MS);
  return Number.isFinite(d) && d >= 60 * 1000 ? d : 24 * 60 * 60 * 1000; // default: daily
})();

// The full scheduled job, run inside ONE transaction:
//   1. Aggregate every finished ONLINE game that hasn't been analyzed yet into the permanent
//      per-student day rollups (student_game_analysis). This guarantees no data loss.
//   2. Aggregate every finished COMPUTER game that hasn't been analyzed yet into the same
//      permanent per-student rollups. Computer games are NOT deleted from raw table (kept permanently).
//   3. Mark those games as analyzed (idempotent — re-runs never double count).
//   4. Delete raw online finished games older than the retention window.
//   5. Write an audit row into cleanup_log.
async function runCleanupJob() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const onlineToAggregate = await client.query(
      `SELECT COUNT(*)::int AS count FROM online_games
       WHERE status = 'finished' AND analysis_aggregated_at IS NULL`
    );

    const computerToAggregate = await client.query(
      `SELECT COUNT(*)::int AS count FROM computer_games
       WHERE status = 'finished' AND analysis_aggregated_at IS NULL`
    );

    const totalToAggregate = onlineToAggregate.rows[0].count + computerToAggregate.rows[0].count;

    // ─── 1. Aggregate ONLINE games ────────────────────────────────────────
    const aggOnline = await client.query(
      `INSERT INTO student_game_analysis
         (student_user_id, period_start, period_end, games, wins, losses, draws, abandoned, avg_moves)
       WITH unanalyzed AS (
         SELECT og.admin_id AS user_left, og.student_id AS user_right, og.admin_color, og.result,
                og.updated_at::date AS game_day,
                COALESCE(og.pgn, '') AS pgn_text
         FROM online_games og
         WHERE og.status = 'finished' AND og.analysis_aggregated_at IS NULL
       ),
       counted AS (
         SELECT user_left, user_right, admin_color, result, game_day,
                NULLIF(array_length(string_to_array(regexp_replace(pgn_text, '[0-9]+[.]\\s*', '', 'g'), ' '), 1), 0) AS move_count
         FROM unanalyzed
       ),
       both_sides AS (
         SELECT user_left AS user_id, admin_color AS my_color, result, game_day, move_count FROM counted
         UNION ALL
         SELECT user_right AS user_id, (CASE WHEN admin_color = 'white' THEN 'black' ELSE 'white' END) AS my_color, result, game_day, move_count FROM counted
       ),
       per_user_day AS (
         SELECT user_id, game_day,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE result = my_color) AS wins,
                COUNT(*) FILTER (WHERE result <> my_color AND result IN ('white','black')) AS losses,
                COUNT(*) FILTER (WHERE result = 'draw') AS draws,
                COUNT(*) FILTER (WHERE result = 'abandoned' OR result IS NULL) AS abandoned,
                AVG(move_count)::float AS avg_moves
         FROM both_sides
         GROUP BY user_id, game_day
       )
       SELECT user_id, game_day, game_day, games, wins, losses, draws, abandoned, COALESCE(avg_moves, 0)
       FROM per_user_day
       ON CONFLICT (student_user_id, period_start) DO UPDATE SET
         games = student_game_analysis.games + EXCLUDED.games,
         wins = student_game_analysis.wins + EXCLUDED.wins,
         losses = student_game_analysis.losses + EXCLUDED.losses,
         draws = student_game_analysis.draws + EXCLUDED.draws,
         abandoned = student_game_analysis.abandoned + EXCLUDED.abandoned,
         avg_moves = CASE
           WHEN student_game_analysis.games + EXCLUDED.games = 0 THEN 0
           ELSE (
             (student_game_analysis.avg_moves * student_game_analysis.games) +
             (EXCLUDED.avg_moves * EXCLUDED.games)
           ) / (student_game_analysis.games + EXCLUDED.games)
         END,
         period_end = GREATEST(student_game_analysis.period_end, EXCLUDED.period_end)
       `
    );

    // ─── 2. Aggregate COMPUTER games ──────────────────────────────────────
    const aggComputer = await client.query(
      `INSERT INTO student_game_analysis
         (student_user_id, period_start, period_end, games, wins, losses, draws, abandoned, avg_moves)
       WITH per_user_day AS (
         SELECT cg.student_user_id AS user_id,
                cg.created_at::date AS game_day,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE cg.result = cg.player_color) AS wins,
                COUNT(*) FILTER (WHERE cg.result IS NOT NULL AND cg.result <> cg.player_color AND cg.result <> 'draw') AS losses,
                COUNT(*) FILTER (WHERE cg.result = 'draw') AS draws,
                0 AS abandoned,
                AVG(COALESCE(cg.moves_count, 0))::float AS avg_moves
         FROM computer_games cg
         WHERE cg.status = 'finished' AND cg.analysis_aggregated_at IS NULL
         GROUP BY cg.student_user_id, cg.created_at::date
       )
       SELECT user_id, game_day, game_day, games, wins, losses, draws, abandoned, COALESCE(avg_moves, 0)
       FROM per_user_day
       ON CONFLICT (student_user_id, period_start) DO UPDATE SET
         games = student_game_analysis.games + EXCLUDED.games,
         wins = student_game_analysis.wins + EXCLUDED.wins,
         losses = student_game_analysis.losses + EXCLUDED.losses,
         draws = student_game_analysis.draws + EXCLUDED.draws,
         abandoned = student_game_analysis.abandoned + EXCLUDED.abandoned,
         avg_moves = CASE
           WHEN student_game_analysis.games + EXCLUDED.games = 0 THEN 0
           ELSE (
             (student_game_analysis.avg_moves * student_game_analysis.games) +
             (EXCLUDED.avg_moves * EXCLUDED.games)
           ) / (student_game_analysis.games + EXCLUDED.games)
         END,
         period_end = GREATEST(student_game_analysis.period_end, EXCLUDED.period_end)
       `
    );

    const rowsWritten = aggOnline.rowCount + aggComputer.rowCount;

    // ─── 3. Mark analyzed ─────────────────────────────────────────────────
    await client.query(
      `UPDATE online_games SET analysis_aggregated_at = NOW()
       WHERE status = 'finished' AND analysis_aggregated_at IS NULL`
    );
    await client.query(
      `UPDATE computer_games SET analysis_aggregated_at = NOW()
       WHERE status = 'finished' AND analysis_aggregated_at IS NULL`
    );

    // ─── 4. Delete aged-out online games (computer games kept permanently) ─
    const del = await client.query(
      `DELETE FROM online_games
       WHERE status = 'finished' AND updated_at::date < (CURRENT_DATE - $1::int)
       RETURNING id`,
      [RETENTION_DAYS]
    );
    const rowsDeleted = del.rowCount;

    // ─── 5. Audit log ─────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO cleanup_log (job_type, rows_aggregated, rows_written, rows_deleted, retention_days)
       VALUES ('game_history', $1, $2, $3, $4)`,
      [totalToAggregate, rowsWritten, rowsDeleted, RETENTION_DAYS]
    );

    await client.query('COMMIT');
    console.log(
      `[game-history] cleanup ran: online=${onlineToAggregate.rows[0].count} + computer=${computerToAggregate.rows[0].count} = ${totalToAggregate} games, wrote ${rowsWritten} analysis rows, deleted ${rowsDeleted} old online rows (retention ${RETENTION_DAYS}d)`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[game-history] cleanup job failed:', err.message);
  } finally {
    client.release();
  }
}

// Start the scheduled job at boot (runs once immediately, then on an interval).
function startGameHistoryScheduler() {
  console.log(
    `[game-history] scheduler started (interval ${Math.round(RUN_INTERVAL_MS / 60000)} min, retention ${RETENTION_DAYS} days)`
  );
  runCleanupJob();
  setInterval(runCleanupJob, RUN_INTERVAL_MS);
}

module.exports = { runCleanupJob, startGameHistoryScheduler };