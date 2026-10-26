require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_online_class_id.sql'), 'utf8')
    );
    const chk = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'online_games' AND column_name = 'class_id'`
    );
    if (chk.rows.length === 0) throw new Error('Missing online_games.class_id column');
    console.log('PVP MIGRATION OK — online_games.class_id present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();