require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_reactions.sql'), 'utf8')
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_reactions' ORDER BY column_name`
    );
    const want = ['created_at', 'emoji', 'id', 'message_id', 'scope', 'user_id'];
    const got = cols.rows.map((r) => r.column_name);
    if (want.some((w) => !got.includes(w))) throw new Error('chat_reactions columns missing: ' + got.join(','));
    console.log('CHAT REACTIONS MIGRATION OK —', got.join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();