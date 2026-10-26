/* Reset all student ratings + rating history so everyone starts fresh.
 *
 * SCOPE (confirmed): students rating columns, student_time_ratings,
 * rating_history, time_control_rating_history, student_levels,
 * student_game_analysis, certificates (type='level' only), chess_ratings,
 * chess_rating_history, game_analysis, imported_game_analysis.
 * NOT touched: users/accounts, classes, puzzles, drills, messages,
 * notifications, academy_badges, non-level certificates, schema/code.
 *
 * Run:  node scripts/reset-ratings.js            (DRY RUN: prints counts only)
 *       node scripts/reset-ratings.js --confirm (REAL RUN, single transaction)
 *
 * A backup is written first in BOTH modes (see backup-ratings.js output path
 * pattern) so --confirm never runs without a restore point. The real run
 * locks all affected tables up front, so a game finishing mid-reset waits
 * and then recomputes from the fresh defaults.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const CONFIRM = process.argv.includes('--confirm');

async function count(client, sql, params = []) {
  return Number((await client.query(sql, params)).rows[0].c);
}

async function main() {
  const info = await db.query(`
    SELECT COUNT(*) FILTER (WHERE u.role = 'student') AS students,
           COUNT(*) FILTER (WHERE u.role <> 'student' OR u.role IS NULL) AS non_students
      FROM students s LEFT JOIN users u ON u.id = s.user_id`);
  console.log(`student rows (role=student): ${info.rows[0].students}, non-student student-rows: ${info.rows[0].non_students}`);

  const scoped = `s.id IN (SELECT s2.id FROM students s2 JOIN users u ON u.id = s2.user_id WHERE u.role = 'student')`;
  const studentIds = `(SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.role = 'student')`;

  const plan = [
    ['students (rating cols -> 1000/1000/1/0/0/NULL)', `SELECT COUNT(*) c FROM students s JOIN users u ON u.id = s.user_id WHERE u.role = 'student'`],
    ['student_time_ratings rows (delete)', `SELECT COUNT(*) c FROM student_time_ratings WHERE student_id IN ${studentIds}`],
    ['rating_history rows (delete)', `SELECT COUNT(*) c FROM rating_history WHERE student_id IN ${studentIds}`],
    ['time_control_rating_history rows (delete)', `SELECT COUNT(*) c FROM time_control_rating_history WHERE student_id IN ${studentIds}`],
    ['student_levels rows (delete)', `SELECT COUNT(*) c FROM student_levels WHERE student_id IN ${studentIds}`],
    ['student_game_analysis rows (delete)', `SELECT COUNT(*) c FROM student_game_analysis WHERE student_user_id IN (SELECT u.id FROM users u WHERE u.role = 'student')`],
    ["certificates type='level' (delete)", `SELECT COUNT(*) c FROM certificates WHERE type = 'level' AND student_id IN ${studentIds}`],
  ];
  // student_game_analysis keying: fall back to unscoped count if the column differs
  let sgaCount;
  try {
    sgaCount = await count(db, plan[5][1]);
  } catch {
    sgaCount = await count(db, 'SELECT COUNT(*) c FROM student_game_analysis');
    plan[5][0] += ' [unscoped: key column not as expected]';
  }

  console.log('\n--- reset plan (student-scoped) ---');
  for (const [label, sql] of plan) {
    if (label.startsWith('student_game_analysis')) {
      console.log(`${sgaCount} x ${label}`);
      continue;
    }
    console.log(`${await count(db, sql)} x ${label}`);
  }
  for (const t of ['chess_ratings', 'chess_rating_history', 'game_analysis', 'imported_game_analysis']) {
    console.log(`${await count(db, `SELECT COUNT(*) c FROM ${t}`)} x ${t} rows (delete all)`);
  }

  // Untouched-table checksum.
  console.log('\n--- untouched tables (must be identical before/after) ---');
  for (const t of ['users', 'online_games', 'classes', 'notifications', 'puzzle_attempts', 'tournaments', 'academy_badges', 'user_academy_badges']) {
    try {
      console.log(`${t}: ${await count(db, `SELECT COUNT(*) c FROM ${t}`)}`);
    } catch {
      console.log(`${t}: (no such table)`);
    }
  }

  // Backup first, in both modes.
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `ratings-reset-${stamp}${CONFIRM ? '' : '-dryrun'}.json`);
  const data = { created_at: new Date().toISOString(), dry_run: !CONFIRM, tables: {} };
  for (const t of ['students', 'student_time_ratings', 'rating_history', 'time_control_rating_history',
    'student_levels', 'student_game_analysis', 'certificates', 'chess_ratings',
    'chess_rating_history', 'game_analysis', 'imported_game_analysis']) {
    data.tables[t] = (await db.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
  }
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`\nbackup: ${file} (restore: node scripts/restore-ratings-backup.js "${file}")`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — no writes. Re-run with --confirm to apply.');
    await db.pool.end();
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Block concurrent rating writers until commit: they wait, then recompute
    // from the fresh defaults instead of writing stale numbers over the reset.
    await client.query(`LOCK TABLE students, student_time_ratings, rating_history,
      time_control_rating_history, student_levels, student_game_analysis,
      certificates, chess_ratings, chess_rating_history,
      game_analysis, imported_game_analysis IN EXCLUSIVE MODE`);
    await client.query(
      `UPDATE students s SET current_rating = 1000, peak_rating = 1000,
              highest_level = 1, games_played = 0, provisional_games = 0,
              last_rating_change_at = NULL
         FROM users u WHERE u.id = s.user_id AND u.role = 'student'`);
    await client.query(`DELETE FROM student_time_ratings WHERE student_id IN ${studentIds}`);
    await client.query(`DELETE FROM rating_history WHERE student_id IN ${studentIds}`);
    await client.query(`DELETE FROM time_control_rating_history WHERE student_id IN ${studentIds}`);
    await client.query(`DELETE FROM student_levels WHERE student_id IN ${studentIds}`);
    try {
      await client.query(`DELETE FROM student_game_analysis WHERE student_user_id IN (SELECT u.id FROM users u WHERE u.role = 'student')`);
    } catch {
      await client.query('DELETE FROM student_game_analysis');
    }
    await client.query(`DELETE FROM certificates WHERE type = 'level' AND student_id IN ${studentIds}`);
    await client.query('DELETE FROM chess_ratings');
    await client.query('DELETE FROM chess_rating_history');
    await client.query('DELETE FROM game_analysis');
    await client.query('DELETE FROM imported_game_analysis');
    await client.query('COMMIT');
    console.log('\nRESET APPLIED. Verification:');
    console.log('students not at default:',
      await count(db, `SELECT COUNT(*) c FROM students s JOIN users u ON u.id = s.user_id
        WHERE u.role = 'student' AND (current_rating <> 1000 OR peak_rating <> 1000 OR games_played <> 0)`));
    for (const t of ['student_time_ratings', 'rating_history', 'time_control_rating_history',
      'student_levels', 'student_game_analysis', 'chess_ratings', 'chess_rating_history',
      'game_analysis', 'imported_game_analysis']) {
      console.log(`${t} rows left: ${await count(db, `SELECT COUNT(*) c FROM ${t}`)}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('RESET FAILED (rolled back):', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
