require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_online_classes.sql'), 'utf8')
    );
    const st = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'classes' AND column_name = 'is_online'`
    );
    if (!st.rows.some((r) => r.column_name === 'is_online')) {
      throw new Error('Missing classes.is_online column');
    }
    console.log('ONLINE CLASSES MIGRATION OK — classes.is_online present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
