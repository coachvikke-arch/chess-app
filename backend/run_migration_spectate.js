require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_class_spectate_enabled.sql'), 'utf8')
    );
    const requiredCols = ['spectate_enabled'];
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
    console.log('CLASS SPECTATE MIGRATION OK - spectate_enabled present on classes.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
