/* Backup for the ratings reset: exports every affected table to a timestamped
 * JSON file. Run: node scripts/backup-ratings.js
 * Restore: node scripts/restore-ratings-backup.js <backup-file>
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const TABLES = [
  'students',
  'student_time_ratings',
  'rating_history',
  'time_control_rating_history',
  'student_levels',
  'student_game_analysis',
  'certificates',
  'chess_ratings',
  'chess_rating_history',
  'game_analysis',
  'imported_game_analysis',
];

async function main() {
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `ratings-reset-${stamp}.json`);
  const data = { created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const r = await db.query(`SELECT * FROM ${t} ORDER BY id`);
    data.tables[t] = r.rows;
    console.log(`${t}: ${r.rows.length} rows`);
  }
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`\nbackup written: ${file}`);
  console.log(`restore with: node scripts/restore-ratings-backup.js "${file}"`);
  await db.pool.end();
}

main().catch((err) => { console.error('backup failed:', err.message); process.exitCode = 1; });
