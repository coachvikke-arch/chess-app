require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_group_chat.sql'), 'utf8')
    );
    const tables = ['chat_groups', 'chat_group_members', 'chat_group_reads', 'chat_group_messages'];
    for (const t of tables) {
      const st = await db.pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [t]
      );
      if (st.rows.length === 0) throw new Error(`Missing table ${t}`);
    }
    console.log('GROUP CHAT MIGRATION OK — chat_groups, chat_group_members, chat_group_reads, chat_group_messages present');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();