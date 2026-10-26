require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_chat_dm_columns.sql'), 'utf8')
    );
    const s = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='chat_messages' AND column_name='sender_id'`
    );
    const n = await db.pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='chat_messages'
          AND column_name IN ('live_class_id','user_id') ORDER BY column_name`
    );
    if (s.rows.length === 0) throw new Error('missing sender_id');
    if (n.rows.some((r) => r.is_nullable !== 'YES')) throw new Error('NOT NULL constraints not dropped');
    console.log('CHAT DM COLUMNS MIGRATION OK — sender_id added+backfilled, live_class_id + user_id now nullable');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();