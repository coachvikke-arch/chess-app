const db = require('./src/config/database');

/* pg returns DATE columns as JS Date objects — normalise to YYYY-MM-DD. */
function toDateStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Safety net: dump the tables this script touches so it can be undone. */
async function backup() {
  const out = {};
  out.assignments = (await db.query("SELECT * FROM assignments WHERE type = 'puzzle_assignment'")).rows;
  out.links = (await db.query('SELECT * FROM assignment_puzzles')).rows;
  out.subs = (await db.query('SELECT * FROM assignment_submissions')).rows;
  out.originals = (await db.query('SELECT COUNT(*)::int AS n FROM student_puzzle_assignments')).rows[0].n;
  return out;
}


/**
 * Backfill: turn existing library assignments (`student_puzzle_assignments`)
 * into real `puzzle_assignment` rows so they appear in the coach's
 * "Puzzle Assignments" screen.
 *
 * One assignment per (assigned_date, set_code) batch — that matches how the
 * library was actually used. The original student_puzzle_assignments rows are
 * NOT touched.
 *
 * Idempotent: skips any batch that already has a mirrored assignment.
 * Run: node backfill_library_assignments.js
 */
(async () => {
  const before = await backup();
  console.log(`BEFORE: ${before.assignments.length} assignments, ${before.links.length} links, ` +
              `${before.subs.length} submissions, ${before.originals} original rows kept\n`);

  // Clear any PARTIAL mirror output from a previous interrupted run (rows with no
  // submissions) so this script always produces a complete set. Only touches
  // rows this script created — `student_puzzle_assignments` is never modified.
  if (before.assignments.length > 0 && before.subs.length === 0) {
    const ids = before.assignments.map((a) => a.id);
    await db.query('DELETE FROM assignment_puzzles WHERE assignment_id = ANY($1)', [ids]);
    await db.query('DELETE FROM assignments WHERE id = ANY($1)', [ids]);
    console.log(`cleaned ${ids.length} partial assignment(s) from an earlier run\n`);
  }

  const groups = await db.query(
    `SELECT spa.assigned_date,
            spa.due_date,
            p.set_code,
            s.name AS set_name,
            MAX(spa.assigned_by) AS assigned_by,
            MAX(spa.max_attempts) AS max_attempts,
            MIN(spa.id) AS first_id
     FROM student_puzzle_assignments spa
     JOIN puzzles p ON p.id = spa.puzzle_id
     LEFT JOIN sets s ON s.code = p.set_code
     GROUP BY spa.assigned_date, spa.due_date, p.set_code, s.name
     ORDER BY spa.assigned_date, p.set_code`
  );

  console.log(`found ${groups.rows.length} batch(es) to mirror\n`);

  let created = 0;
  let skipped = 0;

  for (const g of groups.rows) {
    // Already mirrored? (matched by the batch's own date + set)
    // pg hands back a JS Date; normalise to YYYY-MM-DD for comparison.
    const dateStr = toDateStr(g.assigned_date);
    const dup = await db.query(
      `SELECT a.id
       FROM assignments a
       WHERE a.type = 'puzzle_assignment' AND a.puzzle_set_code = $1
         AND TO_CHAR(a.created_at, 'YYYY-MM-DD') = $2`,
      [g.set_code, dateStr]
    );
    if (dup.rows.length > 0) {
      console.log(`- skip  ${g.set_name || g.set_code} @ ${dateStr} (already mirrored)`);
      skipped += 1;
      continue;
    }

    const puzzles = await db.query(
      `SELECT spa.puzzle_id, spa.student_id, spa.status
       FROM student_puzzle_assignments spa
       WHERE spa.assigned_date = $1 AND ($2::text IS NULL OR spa.puzzle_id IN
             (SELECT id FROM puzzles WHERE set_code = $2))
       ORDER BY spa.puzzle_id, spa.student_id`,
      [g.assigned_date, g.set_code]
    );

    const puzzleIds = [...new Set(puzzles.rows.map((r) => r.puzzle_id))];
    const studentIds = [...new Set(puzzles.rows.map((r) => r.student_id))];
    if (puzzleIds.length === 0 || studentIds.length === 0) { skipped += 1; continue; }


    const label = g.set_name || g.set_code || 'Puzzles';
    const day = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const title = `${label} — ${day}`;

    const ins = await db.query(
      `INSERT INTO assignments
         (title, type, status, max_attempts, due_date, puzzle_set_code, created_by, created_at)
       VALUES ($1, 'puzzle_assignment', 'active', $2, NULLIF($3::text, '')::date, $4, $5, $6::date)
       RETURNING id`,
      [title, g.max_attempts || 1, toDateStr(g.due_date), g.set_code, g.assigned_by, dateStr]
    );
    const assignmentId = ins.rows[0].id;

    await db.query(
      `INSERT INTO assignment_puzzles (assignment_id, puzzle_id, order_index)
       SELECT $1, t.puzzle_id, (t.ord - 1)::int
       FROM unnest($2::int[]) WITH ORDINALITY AS t(puzzle_id, ord)`,
      [assignmentId, puzzleIds]
    );

    // Seed one submission per student, carrying over their completed count and
    // status so the tracker is not blank.
    for (const sid of studentIds) {
      const mine = puzzles.rows.filter((r) => r.student_id === sid);
      const done = mine.filter((r) => r.status === 'completed').length;
      let status = 'pending';
      if (done > 0) status = done >= mine.length ? 'submitted' : 'in_progress';
      if (toDateStr(g.due_date) && new Date(g.due_date) < new Date() && done === 0) status = 'overdue';

      await db.query(
        `INSERT INTO assignment_submissions
           (assignment_id, student_id, status, progress_completed, submitted_at)
         VALUES ($1, $2, $3::text, $4, CASE WHEN $3::text IN ('submitted','reviewed') THEN NOW() ELSE NULL END)
         ON CONFLICT (assignment_id, student_id) DO NOTHING`,
        [assignmentId, sid, status, done]
      );
    }

    console.log(`- made  "${title}" (#${assignmentId}) — ${puzzleIds.length} puzzles, ${studentIds.length} students`);
    created += 1;
  }

  const check = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM assignments WHERE type = 'puzzle_assignment') AS assignments,
            (SELECT COUNT(*)::int FROM assignment_puzzles) AS links,
            (SELECT COUNT(*)::int FROM assignment_submissions) AS submissions,
            (SELECT COUNT(*)::int FROM student_puzzle_assignments) AS originals_kept`
  );
  console.log(`\ncreated ${created}, skipped ${skipped}`);
  console.log('now:', JSON.stringify(check.rows[0]));
  await db.pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });


