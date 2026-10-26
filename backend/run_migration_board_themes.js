require('dotenv').config();
const fs = require('fs');
const db = require('./src/config/database');

(async () => {
  const file = process.argv[2] || 'add_board_themes.sql';
  try {
    await db.pool.query(fs.readFileSync(require('path').join(__dirname, 'migrations', file), 'utf8'));
    const st = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name IN ('board_theme','piece_set')`
    );
    const missing = ['board_theme', 'piece_set'].filter(
      (c) => !st.rows.some((r) => r.column_name === c)
    );
    if (missing.length) throw new Error(`Missing users columns: ${missing.join(', ')}`);
    console.log('BOARD THEMES MIGRATION OK — users.board_theme + piece_set (and students.default_board_theme) present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();