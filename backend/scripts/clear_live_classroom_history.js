/* Clear all Live Classroom history so the feature behaves like a brand-new setup.
 *
 * Deletes the `classes` table rows and their class-scoped child records
 * (attendance, class_students, live_class_participants, chess_game_states,
 * live_class_move_grants, live_class_puzzle_drills -> live_class_puzzle_progress,
 * chat_messages.live_class_id). online_games.class_id and bot_game_results.class_id
 * are SET NULL by FK so those games remain and are untouched.
 *
 * SCOPE (confirmed live): attendance (12), class_students (8), live_class_participants (60),
 * chess_game_states (26), live_class_puzzle_drills (9), live_class_puzzle_progress (11),
 * chat_messages (3) — all cascade from classes. online_games (16 class-tagged out of 79
 * total) and sigma_moves (8) are preserved.
 *
 * Run:  node scripts/clear_live_classroom_history.js            (DRY RUN: prints counts only)
 *       node scripts/clear_live_classroom_history.js --confirm (REAL RUN, single transaction)
 *
 * A backup is written first in BOTH modes (backend/backups/live-classroom-history-<stamp>.json)
 * so --confirm never runs without a restore point.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const CONFIRM = process.argv.includes('--confirm');

async function count(client, sql) {
  return Number((await client.query(sql)).rows[0].c);
}

async function main() {
  const classCount = await count(db, 'SELECT COUNT(*) c FROM classes');
  console.log(`classes rows: ${classCount}`);

  const scoped = `class_id IN (SELECT id FROM classes)`;
  const scopedLive = `live_class_id IN (SELECT id FROM classes)`;

  const plan = [
    ['attendance (delete)', `SELECT COUNT(*) c FROM attendance WHERE ${scoped}`],
    ['class_students (delete)', `SELECT COUNT(*) c FROM class_students WHERE ${scoped}`],
    ['live_class_participants (delete)', `SELECT COUNT(*) c FROM live_class_participants WHERE ${scopedLive}`],
    ['chess_game_states (delete)', `SELECT COUNT(*) c FROM chess_game_states WHERE ${scopedLive}`],
    ['live_class_move_grants (delete)', `SELECT COUNT(*) c FROM live_class_move_grants WHERE ${scopedLive}`],
    ['live_class_puzzle_drills (delete)', `SELECT COUNT(*) c FROM live_class_puzzle_drills WHERE ${scopedLive}`],
    ['live_class_puzzle_progress (delete via drills)', `SELECT COUNT(*) c FROM live_class_puzzle_progress WHERE drill_id IN (SELECT id FROM live_class_puzzle_drills WHERE ${scopedLive})`],
    ['chat_messages class-scoped (delete)', `SELECT COUNT(*) c FROM chat_messages WHERE ${scopedLive}`],
    ['classes (delete)', 'SELECT COUNT(*) c FROM classes'],
    ['online_games class-tagged (SET NULL, preserved)', `SELECT COUNT(*) c FROM online_games WHERE class_id IS NOT NULL`],
    ['bot_game_results class-tagged (SET NULL, preserved)', `SELECT COUNT(*) c FROM bot_game_results WHERE class_id IS NOT NULL`],
  ];

  for (const [label, sql] of plan) {
    console.log(`${label}: ${await count(db, sql)}`);
  }

  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `live-classroom-history-${stamp}${CONFIRM ? '' : '-dryrun'}.json`);

  const backup = {
    classes: (await db.query('SELECT * FROM classes ORDER BY id')).rows,
    attendance: (await db.query(`SELECT * FROM attendance WHERE ${scoped} ORDER BY id`)).rows,
    class_students: (await db.query(`SELECT * FROM class_students WHERE ${scoped} ORDER BY id`)).rows,
    live_class_participants: (await db.query(`SELECT * FROM live_class_participants WHERE ${scopedLive} ORDER BY id`)).rows,
    chess_game_states: (await db.query(`SELECT * FROM chess_game_states WHERE ${scopedLive} ORDER BY id`)).rows,
    live_class_move_grants: (await db.query(`SELECT * FROM live_class_move_grants WHERE ${scopedLive} ORDER BY live_class_id, user_id`)).rows,
    live_class_puzzle_drills: (await db.query(`SELECT * FROM live_class_puzzle_drills WHERE ${scopedLive} ORDER BY id`)).rows,
    live_class_puzzle_progress: (await db.query(`SELECT * FROM live_class_puzzle_progress WHERE drill_id IN (SELECT id FROM live_class_puzzle_drills WHERE ${scopedLive}) ORDER BY id`)).rows,
    chat_messages: (await db.query(`SELECT * FROM chat_messages WHERE ${scopedLive} ORDER BY id`)).rows,
  };
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log(`\nBackup written: ${file}`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — no rows deleted. Run again with --confirm to execute.');
    await db.pool.end();
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM classes');
    await client.query('COMMIT');
    console.log('\nDeleted classes + cascade children (attendance, class_students, live_class_participants, chess_game_states, live_class_move_grants, live_class_puzzle_drills -> progress, chat_messages).');
    console.log('online_games.class_id and bot_game_results.class_id set to NULL (games preserved).');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
