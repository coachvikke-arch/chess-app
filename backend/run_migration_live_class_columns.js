require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_live_class_columns.sql'), 'utf8')
    );
    const requiredCols = ['status', 'started_at', 'ended_at', 'class_type', 'thumbnail', 'chat_mode', 'student_interaction_enabled'];
    const st = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'classes' AND column_name = ANY($1::text[])`,
      [requiredCols]
    );
    const found = st.rows.map(r => r.column_name);
    const missing = requiredCols.filter(c => !found.includes(c));
    if (missing.length > 0) {
      throw new Error('Missing classes columns: ' + missing.join(', '));
    }
    console.log('LIVE CLASS COLUMNS MIGRATION OK — 7 new columns present on classes:', requiredCols.join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
