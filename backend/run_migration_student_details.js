require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_student_details.sql'), 'utf8')
    );
    const chk = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'students'`
    );
    const cols = chk.rows.map((r) => r.column_name);
    ['parent_name', 'nickname', 'gender', 'preferred_language'].forEach((c) => {
      if (!cols.includes(c)) throw new Error(`Missing column: ${c}`);
    });
    console.log('STUDENT DETAILS MIGRATION OK — parent_name, nickname, gender, preferred_language present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();