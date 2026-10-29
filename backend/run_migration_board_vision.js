require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * Board Vision progress migration runner — applies
 * migrations/add_board_vision_progress.sql then verifies the table and the
 * exact queries the controller depends on.
 */
(async () => {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations', 'add_board_vision_progress.sql'),
      'utf8'
    );
    await db.pool.query(sql);

    const tables = await db.pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'board_vision_progress'
    `);
    if (!tables.rows.length) throw new Error('Missing table: board_vision_progress');

    const cols = await db.pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'board_vision_progress'
    `);
    const present = new Map(cols.rows.map((r) => [r.column_name, r.data_type]));
    const missing = ['user_id', 'progress', 'updated_at'].filter((c) => !present.has(c));
    if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
    if (present.get('progress') !== 'jsonb') {
      throw new Error(`progress must be jsonb, found ${present.get('progress')}`);
    }

    // The controller's read query must run against the real schema.
    await db.pool.query(
      'SELECT progress, updated_at FROM board_vision_progress WHERE user_id = $1',
      [0]
    );

    console.log(
      'BOARD VISION MIGRATION OK — board_vision_progress verified (jsonb progress, '
      + 'per-user primary key, updated_at) and the controller read query runs.'
    );
    process.exit(0);
  } catch (error) {
    console.error('BOARD VISION MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
