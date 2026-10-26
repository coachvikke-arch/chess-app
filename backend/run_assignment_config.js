const fs = require('fs');
const { pool } = require('./src/config/database');

(async () => {
  const sql = fs.readFileSync('migrations/add_assignment_config_settings.sql', 'utf8');
  await pool.query(sql);
  const t = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'student_puzzle_assignments' AND column_name IN ('time_limit_seconds','points','max_attempts','negative_points') ORDER BY column_name"
  );
  console.log('config columns ready:', t.rows.map((r) => r.column_name).join(', '));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });