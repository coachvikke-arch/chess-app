require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_live_class_participants.sql'), 'utf8')
    );
    const st = await db.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'live_class_participants'`
    );
    if (st.rows.length === 0) {
      throw new Error('Missing table live_class_participants');
    }
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'live_class_participants'`
    );
    console.log('LIVE CLASS PARTICIPANTS MIGRATION OK — table exists with columns:', cols.rows.map(r => r.column_name).join(', '));
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
