require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_online_result_reason.sql'), 'utf8')
    );
    const col = await db.pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'online_games' AND column_name = 'result_reason'`
    );
    if (!col.rows.length) throw new Error('online_games.result_reason was not created');
    const c = col.rows[0];
    console.log('ONLINE RESULT REASON OK -', c.column_name, c.data_type, 'nullable', c.is_nullable);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
