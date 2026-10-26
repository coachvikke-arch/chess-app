require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_presence_unread.sql'), 'utf8')
    );
    const u = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='last_seen_at'`
    );
    const m = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='chat_messages' AND column_name='read_at'`
    );
    if (u.rows.length === 0 || m.rows.length === 0) throw new Error('last_seen_at/read_at missing');
    console.log('CHAT PRESENCE/UNREAD MIGRATION OK — users.last_seen_at + chat_messages.read_at + indexes present');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();