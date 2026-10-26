require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

(async () => {
  try {
    await db.pool.query(
      fs.readFileSync(path.join(__dirname, 'migrations', 'add_class_students.sql'), 'utf8')
    );
    const chk = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'class_students'`
    );
    if (chk.rows.length === 0) throw new Error('Missing class_students table');
    console.log('CLASS STUDENTS MIGRATION OK — class_students present.');
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
