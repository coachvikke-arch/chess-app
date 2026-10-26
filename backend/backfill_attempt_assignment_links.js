const db = require('./src/config/database');

/**
 * One-time backfill: link existing `puzzle_attempts` to the coach assignment
 * they belong to.
 *
 * The attempt recorder now sets `puzzle_assignment_id`, but attempts made
 * before that fix are NULL, so the coach's review screen (which filters on
 * that column) shows nothing. This matches each attempt to the assignment that
 * contains its puzzle AND was actually given to that student.
 *
 * Idempotent — only touches rows where the column is NULL, and never overwrites
 * a link that already exists. Run: node backfill_attempt_assignment_links.js
 */
(async () => {
  const before = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE puzzle_assignment_id IS NOT NULL)::int AS linked
     FROM puzzle_attempts`
  );
  console.log(`BEFORE: ${before.rows[0].linked}/${before.rows[0].total} attempts linked\n`);

  const res = await db.query(
    `UPDATE puzzle_attempts pa
     SET puzzle_assignment_id = m.assignment_id
     FROM (
       SELECT DISTINCT pa2.id, ap.assignment_id
       FROM puzzle_attempts pa2
       JOIN assignment_puzzles ap ON ap.puzzle_id = pa2.puzzle_id
       JOIN assignment_submissions s
         ON s.assignment_id = ap.assignment_id AND s.student_id = pa2.student_id
       WHERE pa2.puzzle_assignment_id IS NULL
     ) m
     WHERE pa.id = m.id`
  );
  console.log(`linked ${res.rowCount} attempt(s)`);

  const after = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE puzzle_assignment_id IS NOT NULL)::int AS linked
     FROM puzzle_attempts`
  );
  console.log(`AFTER:  ${after.rows[0].linked}/${after.rows[0].total} attempts linked`);

  // Show a sample so the result is verifiable.
  const sample = await db.query(
    `SELECT pa.id, pa.puzzle_id, pa.student_id, pa.result, pa.points_earned,
            pa.played_moves, pa.puzzle_assignment_id
     FROM puzzle_attempts pa
     WHERE pa.puzzle_assignment_id IS NOT NULL
     ORDER BY pa.id LIMIT 5`
  );
  console.log('\nsample linked attempts:');
  for (const r of sample.rows) console.log('  ', JSON.stringify(r));

  // Which linked attempts land in a reviewable submission?
  const inReview = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM puzzle_attempts pa
     JOIN assignment_submissions s
       ON s.assignment_id = pa.puzzle_assignment_id AND s.student_id = pa.student_id`
  );
  console.log(`\nvisible to a coach review: ${inReview.rows[0].n}`);

  await db.pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
