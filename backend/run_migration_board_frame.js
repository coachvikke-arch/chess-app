require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_board_frame.sql'), 'utf8')
    );
    const col = await db.pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'board_frame'`
    );
    if (!col.rows.length) throw new Error('users.board_frame was not created');
    const c = col.rows[0];
    if (c.data_type !== 'boolean') throw new Error('users.board_frame is ' + c.data_type + ', expected boolean');
    /* Existing accounts must keep their frame — the column default decides that. */
    if (!/true/i.test(String(c.column_default))) {
      throw new Error('users.board_frame default is ' + c.column_default + ', expected true');
    }
    const sample = await db.pool.query(
      'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE board_frame)::int AS framed FROM users'
    );
    console.log('BOARD FRAME MIGRATION OK —', c.data_type, 'default', c.column_default,
      '| users:', sample.rows[0].total, 'framed:', sample.rows[0].framed);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
