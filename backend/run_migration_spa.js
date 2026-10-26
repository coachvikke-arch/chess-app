const fs = require('fs');
const { pool } = require('./src/config/database');

(async () => {
  const sql = fs.readFileSync('migrations/add_student_puzzle_assignments.sql', 'utf8');
  await pool.query(sql);
  const t = await pool.query("SELECT to_regclass('public.student_puzzle_assignments') AS t");
  console.log('student_puzzle_assignments ready:', t.rows[0].t);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
