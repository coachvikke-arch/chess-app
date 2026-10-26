const fs = require('fs');
const { pool } = require('./src/config/database');

(async () => {
  const sql = fs.readFileSync('migrations/repair_puzzle_assignment_status.sql', 'utf8');
  await pool.query(sql);

  const t = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM assignment_submissions
         WHERE status = 'submitted' AND reviewed_at IS NULL AND score IS NULL
           AND submitted_at IS NOT NULL) AS remaining_bugged,
       (SELECT COUNT(*)::int FROM assignment_submissions
         WHERE status = 'submitted' AND score IS NOT NULL) AS legit_submitted,
       (SELECT COUNT(*)::int FROM assignment_submissions
         WHERE status IN ('in_progress','pending')) AS open_work`
  );
  console.log('puzzle assignment status repair ready:', t.rows[0]);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });