require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_calls.sql'), 'utf8')
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_calls' ORDER BY column_name`
    );
    const want = ['callee_id', 'caller_id', 'created_at', 'ended_at', 'id', 'kind', 'room_name', 'started_at', 'status'];
    const got = cols.rows.map((r) => r.column_name);
    const missing = want.filter((w) => !got.includes(w));
    if (missing.length) throw new Error('chat_calls missing columns: ' + missing.join(','));
    console.log('CHAT CALLS MIGRATION OK —', got.join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();