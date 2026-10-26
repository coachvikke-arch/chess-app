require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_message_deletions.sql'), 'utf8')
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_message_deletions' ORDER BY column_name`
    );
    const want = ['created_at', 'id', 'message_id', 'scope', 'user_id'];
    const got = cols.rows.map((r) => r.column_name);
    const missing = want.filter((w) => !got.includes(w));
    if (missing.length) throw new Error('chat_message_deletions missing columns: ' + missing.join(','));
    console.log('CHAT MESSAGE DELETIONS MIGRATION OK —', got.join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();