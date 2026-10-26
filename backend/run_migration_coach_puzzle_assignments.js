const fs = require('fs');
const { pool } = require('./src/config/database');

(async () => {
  const sql = fs.readFileSync('migrations/add_coach_puzzle_assignments.sql', 'utf8');
  await pool.query(sql);

  const t = await pool.query(
    `SELECT to_regclass('public.assignment_puzzles') AS assignment_puzzles,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_name = 'assignments'
                AND column_name IN ('type','max_attempts','status','puzzle_set_code','is_template')) AS assignment_cols,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_name = 'assignment_submissions'
                AND column_name IN ('status','progress_completed','reviewed_at')) AS submission_cols,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_name = 'puzzles' AND column_name = 'points_value') AS puzzle_cols,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_name = 'puzzle_attempts' AND column_name = 'puzzle_assignment_id') AS attempt_cols`
  );
  const r = t.rows[0];
  console.log('coach puzzle assignment migration ready:', {
    assignment_puzzles: r.assignment_puzzles,
    assignment_cols: `${r.assignment_cols}/5`,
    submission_cols: `${r.submission_cols}/3`,
    puzzle_cols: `${r.puzzle_cols}/1`,
    attempt_cols: `${r.attempt_cols}/1`,
  });
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
