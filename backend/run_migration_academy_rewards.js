require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(fs.readFileSync(path.join(__dirname, 'migrations', 'add_academy_reward_unlocks.sql'), 'utf8'));
    const check = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'academy_reward_unlocks'
    `);
    const required = ['student_id', 'level_slug', 'reward_id', 'unlocked_at'];
    const present = check.rows.map((row) => row.column_name);
    const missing = required.filter((column) => !present.includes(column));
    if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
    console.log('ACADEMY REWARD UNLOCK MIGRATION OK — persistent unlock table present.');
    process.exit(0);
  } catch (error) {
    console.error('ACADEMY REWARD UNLOCK MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
