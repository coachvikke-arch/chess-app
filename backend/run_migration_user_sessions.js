require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/* Applies migrations/add_user_sessions.sql and verifies the table + indexes
 * landed. Run: node run_migration_user_sessions.js  (or npm run db:user-sessions) */

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_user_sessions.sql'), 'utf8')
    );

    const requiredCols = [
      'id', 'user_id', 'device_id', 'device_name', 'platform',
      'refresh_token_hash', 'created_at', 'last_active_at', 'revoked_at',
    ];
    const st = await db.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_sessions'`
    );
    const found = st.rows.map((r) => r.column_name);
    const missing = requiredCols.filter((c) => !found.includes(c));
    if (missing.length > 0) {
      throw new Error('Missing user_sessions columns: ' + missing.join(', '));
    }

    const ix = await db.pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'user_sessions' ORDER BY indexname`
    );
    console.log('USER SESSIONS MIGRATION OK — columns:', requiredCols.join(', '));
    console.log('indexes:', ix.rows.map((r) => r.indexname).join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
