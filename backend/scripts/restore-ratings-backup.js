/* Restore a ratings-reset backup created by scripts/backup-ratings.js.
 * Run: node scripts/restore-ratings-backup.js <backup-file>
 * Re-inserts backed-up rows inside one transaction and fixes sequences.
 * students rows are restored RATING-COLUMNS-ONLY (profile info untouched).
 */
const fs = require('fs');
const db = require('../src/config/database');

const RATING_COLS = ['current_rating', 'peak_rating', 'highest_level', 'games_played', 'provisional_games', 'last_rating_change_at'];

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('usage: node scripts/restore-ratings-backup.js <backup-file>');
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // students: rating columns only
    for (const s of data.tables.students || []) {
      await client.query(
        `UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
                games_played=$4, provisional_games=$5, last_rating_change_at=$6 WHERE id=$7`,
        [s.current_rating, s.peak_rating, s.highest_level, s.games_played,
          s.provisional_games, s.last_rating_change_at, s.id],
      );
    }
    // Fully-owned tables: replace contents. Certificates: only level rows.
    const full = ['student_time_ratings', 'rating_history', 'time_control_rating_history',
      'student_levels', 'student_game_analysis', 'chess_ratings', 'chess_rating_history',
      'game_analysis', 'imported_game_analysis'];
    for (const t of full) {
      const rows = data.tables[t] || [];
      await client.query(`DELETE FROM ${t}`);
      for (const r of rows) {
        const keys = Object.keys(r);
        await client.query(
          `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
          keys.map((k) => r[k]),
        );
      }
      const seq = await client.query(
        "SELECT pg_get_serial_sequence($1,'id') AS s", [t]).then((x) => x.rows[0]?.s).catch(() => null);
      if (seq) await client.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${t}), 0))`, [seq]);
    }
    const certs = (data.tables.certificates || []).filter((c) => c.type === 'level');
    await client.query("DELETE FROM certificates WHERE type = 'level'");
    for (const c of certs) {
      const keys = Object.keys(c);
      await client.query(
        `INSERT INTO certificates (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        keys.map((k) => c[k]),
      );
    }
    await client.query('COMMIT');
    console.log(`restored from ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('restore failed (rolled back):', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
