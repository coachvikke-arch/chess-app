require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_auth_username.sql'), 'utf8')
    );
    const chk = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users'`
    );
    const cols = chk.rows.map((r) => r.column_name);
    ['username', 'recovery_code_hash', 'recovery_code_created_at'].forEach((c) => {
      if (!cols.includes(c)) throw new Error(`Missing column: ${c}`);
    });
    const cnt = await db.pool.query(
      `SELECT count(*)::int AS total, count(username)::int AS with_name FROM users`
    );
    const idx = await db.pool.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_users_username_lower'`
    );
    if (idx.rows.length === 0) throw new Error('Missing index: idx_users_username_lower');
    console.log(
      `AUTH USERNAME MIGRATION OK — ${cnt.rows[0].with_name}/${cnt.rows[0].total} users have a username.`
    );
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();