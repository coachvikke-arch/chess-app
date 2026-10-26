require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_move_grants.sql'), 'utf8')
    );
    const st = await db.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'live_class_move_grants'`
    );
    if (st.rows.length === 0) {
      throw new Error('Missing table: live_class_move_grants');
    }
    console.log('MOVE GRANTS MIGRATION OK — live_class_move_grants table present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();