/**
 * Add the canonical rating CATEGORY alongside the human-readable time control.
 *
 * WHY
 * ---
 * `rating_history.time_control` stores a DISPLAY LABEL - 'Rapid', 'Blitz',
 * 'Bullet' - produced by onlineController.onlineTcLabel(). It is what the result
 * card shows the player, and it is fine for that. But it is a free-text label,
 * so nothing can join on it or assert that a game's category was the one its
 * pool actually used: the category that selects the rating pool is computed
 * independently by ratingService.classifyTimeControl().
 *
 * Those two are written from different places (the controller and the service),
 * so a disagreement between them - or a future edit to either threshold - would
 * silently score a game into one pool while labelling it with another, and
 * nothing in the schema would catch it. Storing the canonical `time_class`
 * next to the label makes the category queryable and assertable, which is what
 * the per-game category regression tests need.
 *
 * `time_control_rating_history` is also given `online_game_id` so a pool row can
 * be traced back to the game that produced it. Without it there is no way to ask
 * "which rating pool did THIS game move?", which is exactly the question the
 * result card is answering.
 *
 * Both columns are nullable and additive: existing rows keep their values and
 * keep their +/-10-era history. Nothing is recalculated or rewritten.
 */
const db = require('../src/config/database');

async function columnExists(table, column) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

async function main() {
  const adds = [
    ['rating_history', 'time_class', 'text'],
    ['time_control_rating_history', 'online_game_id', 'integer'],
  ];

  for (const [table, column, type] of adds) {
    if (await columnExists(table, column)) {
      console.log(`- ${table}.${column} already exists`);
      continue;
    }
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`+ ${table}.${column} ${type}`);

    /* The foreign key is added separately so it can fail on its own: an
       orphan online_game_id must not abort the column that everything else
       depends on. */
    if (column === 'online_game_id') {
      await db.query(
        `ALTER TABLE time_control_rating_history
           ADD CONSTRAINT time_control_rating_history_online_game_id_fkey
           FOREIGN KEY (online_game_id) REFERENCES online_games(id) ON DELETE SET NULL`,
      );
      console.log('+ FK time_control_rating_history.online_game_id -> online_games(id)');
    }
  }

  /* Helpful for the per-game lookups the tests and the API now do. */
  await db.query(
    `CREATE INDEX IF NOT EXISTS rating_history_online_game_idx
       ON rating_history (online_game_id)`,
  ).catch(() => console.log('- rating_history_online_game_idx already exists'));
  await db.query(
    `CREATE INDEX IF NOT EXISTS tcrh_online_game_idx
       ON time_control_rating_history (online_game_id, student_id)`,
  ).catch(() => console.log('- tcrh_online_game_idx already exists'));

  /* Derive the category for rows that PREDATE the column.

     `time_control` is already the label the category was derived from when the
     game was rated ('Blitz' -> 'blitz'), so lowercasing it restates a value that
     was already decided. This touches NO rating: no rating_before, rating_after,
     rating_change or current_rating is read or written here. It only makes the
     existing category queryable, so old rows can be asserted on like new ones.

     Deliberately NOT done: recomputing any rating. Rows written while the
     opponent-ID bug was live keep their +/-10 values, which were correct given
     the data available at the time. */
  const derived = await db.query(
    `UPDATE rating_history rh
        SET time_class = lower(rh.time_control)
      WHERE rh.time_class IS NULL
        AND rh.time_control IS NOT NULL
      RETURNING rh.id`,
  );
  console.log(`= backfilled time_class on ${derived.rows.length} pre-existing rating_history row(s) `
    + '(category only - no rating was recalculated)');

  /* The pools were never linked to their game before this migration either, so
     rows already in time_control_rating_history can be attributed the same way. */
  const derivedPool = await db.query(
    `UPDATE time_control_rating_history t
        SET online_game_id = g.id
       FROM rating_history rh
       JOIN online_games g ON g.id = rh.online_game_id
      WHERE t.online_game_id IS NULL
        AND t.student_id = rh.student_id
        AND t.played_at = rh.played_at
      RETURNING t.id`,
  );
  console.log(`= linked ${derivedPool.rows.length} pre-existing pool row(s) to their game by timestamp`);

  const stillNull = await db.query(
    'SELECT count(*)::int n FROM rating_history WHERE time_class IS NULL',
  );
  console.log(`= rating_history rows still without a category: ${stillNull.rows[0].n} `
    + '(games with no online row - expected, they have no time control)');

  console.log('done');
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });