require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_attachments.sql'), 'utf8')
    );
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_messages' AND column_name LIKE 'attachment%'`
    );
    const gcols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chat_groups' AND column_name = 'avatar'`
    );
    if (cols.rows.length !== 4) throw new Error('chat_messages attachment columns missing');
    if (gcols.rows.length === 0) throw new Error('chat_groups.avatar missing');
    console.log('CHAT ATTACHMENTS MIGRATION OK — chat_messages.attachment* + chat_groups.avatar present');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();