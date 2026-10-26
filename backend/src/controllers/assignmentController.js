const db = require('../config/database');
const { Chess } = require('chess.js');

/* UCI long algebraic (e2e4, g7g8q). SAN has letters like N, Q, +, #, x, O-O. */
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Apply one stored move (UCI or SAN) to a game, returning the move or null. */
function applyMove(game, token) {
  if (UCI_RE.test(token)) {
    return game.move({
      from: token.slice(0, 2),
      to: token.slice(2, 4),
      promotion: token.length > 4 ? token[4] : undefined,
    });
  }
  return game.move(token);
}

/** Normalize a stored `solution` into a list of move tokens. */
function solutionTokens(solution) {
  return Array.isArray(solution) ? solution : String(solution ?? '').split(/[\s,]+/).filter(Boolean);
}

/**
 * Replay a stored `puzzles.solution` from `fen` and return the SAN sequence.
 * Stops at the first move that does not apply so a malformed row degrades
 * gracefully instead of throwing.
 */
function solutionToSan(fen, solution) {
  const game = new Chess(fen);
  const out = [];
  for (const raw of solutionTokens(solution)) {
    const token = String(raw).trim();
    if (!token) continue;
    let applied = null;
    try { applied = applyMove(game, token); } catch { applied = null; }
    if (!applied) break;
    out.push(applied.san);
  }
  return out;
}

/** Same as solutionToSan but keeps the FEN after each move, for board replay. */
function solutionReplay(fen, solution) {
  const game = new Chess(fen);
  const steps = [];
  for (const raw of solutionTokens(solution)) {
    const token = String(raw).trim();
    if (!token) continue;
    let applied = null;
    try { applied = applyMove(game, token); } catch { applied = null; }
    if (!applied) break;
    steps.push({ san: applied.san, from: applied.from, to: applied.to, uci: token, fen: game.fen() });
  }
  return steps;
}

/**
 * Compare a student's `played_moves` against the correct SAN sequence, returning
 * a per-move verdict so the review screen can colour each chip. A move counts as
 * correct only when it is legal AND matches the expected solution.
 */
function markMoves(fen, correctSan, playedMoves) {
  const game = new Chess(fen);
  return (playedMoves || []).map((raw) => {
    const token = String(raw).trim();
    let san = token;
    let legal = false;
    try {
      const mv = applyMove(game, token);
      if (mv) { san = mv.san; legal = true; }
    } catch { /* illegal — keep the raw token */ }

    // The move we just played sits at the end of the history.
    const index = legal ? game.history().length - 1 : game.history().length;
    const expected = correctSan[index] || null;
    return {
      move: san,
      uci: token,
      legal,
      isCorrect: legal && expected != null && san === expected,
      expected,
    };
  });
}

/* ═══════════════ coach puzzle assignments (puzzle-based) ═══════════════
   Built on the EXISTING assignments / assignment_submissions / puzzle_attempts
   tables so lesson homework is unaffected. `assignment_puzzles` holds the
   ordered puzzle composition of each assignment. */

/** Effective assignment status, combining its own status with the due date. */
function effectiveStatus(row) {
  if (row.status === 'archived') return 'archived';
  if (row.due_date) {
    const due = new Date(row.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return row.status === 'draft' ? 'draft' : 'completed';
  }
  return row.status;
}

/**
 * Effective status of ONE student's work on ONE assignment.
 *
 * Shared by the tracker and the list endpoint on purpose. The list is used to
 * filter by a student, so the two would otherwise be answering the same question
 * with two copies of these rules - and a filtered list that disagrees with the
 * tracker a coach is looking at is worse than no filter at all.
 *
 * Neither rule is stored: overdue is a due-date fact, and "solved every puzzle"
 * can disagree with the stored submission status.
 */
function effectiveStudentStatus({ status, dueDate, solved, total, today = new Date() }) {
  let out = status;
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  // Past due and not yet handed in.
  if (dueDate && new Date(dueDate) < startOfToday && !['submitted', 'reviewed'].includes(out)) {
    out = 'overdue';
  }
  // Once every puzzle is solved the submission is complete regardless of what
  // the stored status says. Reads `out`, not `status`, so an overdue submission
  // is not then promoted out of overdue.
  if (total > 0 && solved >= total && ['pending', 'in_progress'].includes(out)) {
    out = 'submitted';
  }
  return out;
}

/* GET /api/assignments/puzzle-assignments — list with live progress counts. */
exports.listPuzzleAssignments = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.title, a.description, a.type, a.status, a.max_attempts,
              a.due_date, a.created_at, a.puzzle_set_code, a.is_template,
              s.name AS set_name, f.name AS folder_name, u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM assignment_puzzles ap WHERE ap.assignment_id = a.id) AS puzzle_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub WHERE sub.assignment_id = a.id) AS student_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id AND sub.status IN ('submitted','reviewed')) AS completed_count,
              (SELECT COALESCE(array_agg(DISTINCT us.name ORDER BY us.name), '{}')
                 FROM assignment_submissions sub2
                 JOIN students st ON st.id = sub2.student_id
                 JOIN users us ON us.id = st.user_id
                WHERE sub2.assignment_id = a.id) AS student_names,
              /* Per-student raw progress, so the same status the tracker shows can
                 be derived for the whole list (see effectiveStudentStatus).
                 Solved is aggregated ONCE per assignment rather than per
                 student - the subquery depends on a.id, not on sub3.student_id.
                 Solved puzzles are matched through assignment_puzzles, because
                 puzzles are shared between assignments and puzzle_assignment_id
                 alone would undercount. */
              (SELECT COALESCE(json_agg(json_build_object(
                          'id', st.id,
                          'name', us.name,
                          'status', sub3.status,
                          'total', COALESCE(ac.total, 0),
                          'solved', LEAST(COALESCE(sv.solved, 0), COALESCE(ac.total, 0))
                        ) ORDER BY us.name), '[]'::json)
                 FROM assignment_submissions sub3
                 JOIN students st ON st.id = sub3.student_id
                 JOIN users us ON us.id = st.user_id
                 LEFT JOIN (
                   SELECT pa.student_id,
                          COUNT(DISTINCT pa.puzzle_id) FILTER (WHERE pa.result = 'correct')::int AS solved
                   FROM puzzle_attempts pa
                   JOIN assignment_puzzles ap2 ON ap2.puzzle_id = pa.puzzle_id
                   WHERE ap2.assignment_id = a.id
                   GROUP BY pa.student_id
                 ) sv ON sv.student_id = sub3.student_id
                 LEFT JOIN (
                   SELECT COUNT(*)::int AS total FROM assignment_puzzles ap3
                   WHERE ap3.assignment_id = a.id
                 ) ac ON TRUE
                WHERE sub3.assignment_id = a.id) AS student_refs
       FROM assignments a
       LEFT JOIN sets s ON s.code = a.puzzle_set_code
       LEFT JOIN set_folders f ON f.id = s.folder_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.type = 'puzzle_assignment'
       ORDER BY a.created_at DESC`
    );

    const rows = result.rows.map((r) => {
      const status = effectiveStatus(r);
      /* Same derivation the tracker uses, so filtering by a student here and
         opening their tracker can never tell two different stories. */
      return {
        ...r,
        status,
        student_refs: (r.student_refs || []).map((s) => ({
          id: s.id,
          name: s.name,
          status: effectiveStudentStatus({
            status: s.status,
            dueDate: r.due_date,
            solved: s.solved,
            total: s.total,
          }),
          /* Per-student puzzle progress travels with the refs too. The classroom
             Assignments tab sums these across assignments for its summary rows,
             so it needs no extra per-assignment round trip (and still reads the
             same numbers the tracker derives). */
          solved: s.solved,
          total: s.total,
        })),

        completionPct: r.student_count > 0 ? Math.round((r.completed_count / r.student_count) * 100) : 0,
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list puzzle assignments', error: err.message });
  }
};

/* GET /api/assignments/puzzle-assignments/sets — sets available to build from. */
exports.listPuzzleAssignmentSets = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT s.code, s.name, f.name AS folder_name,
              COUNT(p.id)::int AS puzzle_count,
              COALESCE(SUM(p.points_value), 0)::int AS total_points
       FROM sets s
       LEFT JOIN set_folders f ON f.id = s.folder_id
       LEFT JOIN puzzles p ON p.set_code = s.code
       GROUP BY s.code, s.name, f.name
       HAVING COUNT(p.id) > 0
       ORDER BY s.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list puzzle sets', error: err.message });
  }
};

/* POST /api/assignments/puzzle-assignments — create from a whole set or ids. */
exports.createPuzzleAssignment = async (req, res) => {
  try {
    const {
      title, description, dueDate, maxAttempts = 1,
      status = 'draft', setCode, puzzleIds = [], isTemplate = false,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Resolve the puzzle list: explicit ids win, otherwise the whole set.
    let ids = Array.isArray(puzzleIds) ? puzzleIds.map(Number).filter(Number.isInteger) : [];
    if (ids.length === 0 && setCode) {
      const setRows = await db.query('SELECT id FROM puzzles WHERE set_code = $1 ORDER BY id', [setCode]);
      ids = setRows.rows.map((r) => r.id);
    }
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Pick a puzzle set or select at least one puzzle' });
    }

    const created = await db.query(
      `INSERT INTO assignments
         (title, description, type, status, max_attempts, due_date, puzzle_set_code, is_template, created_by)
       VALUES ($1,$2,'puzzle_assignment',$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        String(title).trim(), description || null,
        ['draft', 'active', 'archived'].includes(status) ? status : 'draft',
        Math.max(1, Number(maxAttempts) || 1),
        dueDate || null, setCode || null, !!isTemplate, req.user.id,
      ]
    );
    const assignment = created.rows[0];

    // Preserve the coach's ordering via order_index.
    await db.query(
      `INSERT INTO assignment_puzzles (assignment_id, puzzle_id, order_index)
       SELECT $1, t.puzzle_id, (t.ord - 1)::int
       FROM unnest($2::int[]) WITH ORDINALITY AS t(puzzle_id, ord)`,
      [assignment.id, ids]
    );

    res.status(201).json(assignment);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create puzzle assignment', error: err.message });
  }
};

/* POST /api/assignments/puzzle-assignments/:id/assign — assign to students. */
exports.assignPuzzleAssignment = async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const { studentIds = [], allStudents = false, dueDate } = req.body;

    const exists = await db.query(
      `SELECT id FROM assignments WHERE id = $1 AND type = 'puzzle_assignment'`,
      [assignmentId]
    );
    if (exists.rows.length === 0) return res.status(404).json({ message: 'Puzzle assignment not found' });

    let ids = Array.isArray(studentIds) ? studentIds.map(Number).filter(Number.isInteger) : [];
    if (allStudents) {
      const all = await db.query('SELECT id FROM students WHERE active = TRUE');
      ids = all.rows.map((r) => r.id);
    }
    if (ids.length === 0) return res.status(400).json({ message: 'Pick at least one student' });

    // One submission row per student; never clobber existing progress.
    await db.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, status, progress_completed)
       SELECT $1, s, 'pending', 0 FROM unnest($2::int[]) AS s
       ON CONFLICT (assignment_id, student_id) DO NOTHING`,
      [assignmentId, ids]
    );

    if (dueDate) {
      await db.query('UPDATE assignments SET due_date = $1 WHERE id = $2', [dueDate, assignmentId]);
    }

    const total = await db.query(
      'SELECT COUNT(*)::int AS n FROM assignment_submissions WHERE assignment_id = $1',
      [assignmentId]
    );
    res.json({
      message: 'Assigned', assignment_id: assignmentId,
      students: ids.length, total_submissions: total.rows[0].n,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to assign puzzle assignment', error: err.message });
  }
};

/* GET /api/assignments/puzzle-assignments/:id/students — the student tracker. */
exports.getPuzzleAssignmentStudents = async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);

    const quiz = await db.query(
      `SELECT a.id, a.title, a.due_date, a.max_attempts, a.status,
              (SELECT COUNT(*)::int FROM assignment_puzzles ap WHERE ap.assignment_id = a.id) AS puzzle_count
       FROM assignments a WHERE a.id = $1 AND a.type = 'puzzle_assignment'`,
      [assignmentId]
    );
    if (quiz.rows.length === 0) return res.status(404).json({ message: 'Puzzle assignment not found' });
    const q = quiz.rows[0];

    // Per-student rollup. Scoped to the ASSIGNMENT's puzzles and the student's
    // own attempts, for the same reason as the review screen: puzzles can be
    // shared between assignments, so `puzzle_assignment_id` alone undercounts.
    // `solved` counts DISTINCT puzzles the student got right (not attempts), and
    // `progress_completed` is derived from that same number so the tracker and
    // the review can never disagree.
    const subs = await db.query(
      `SELECT sub.id AS submission_id, sub.student_id, sub.status,
              sub.submitted_at, sub.reviewed_at, sub.score,
              s.user_id, u.name AS student_name, u.email,
              COALESCE(agg.attempt_count, 0)::int AS attempt_count,
              COALESCE(agg.points, 0)::int AS points,
              COALESCE(agg.time_taken, 0)::int AS time_taken,
              COALESCE(agg.solved, 0)::int AS solved
       FROM assignment_submissions sub
       JOIN students s ON s.id = sub.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN (
         SELECT pa.student_id,
                COUNT(*)::int AS attempt_count,
                COALESCE(SUM(CASE WHEN pa.result = 'correct' THEN pa.points_earned ELSE 0 END), 0)::int AS points,
                COALESCE(SUM(pa.time_taken), 0)::int AS time_taken,
                COUNT(DISTINCT pa.puzzle_id) FILTER (WHERE pa.result = 'correct')::int AS solved
         FROM puzzle_attempts pa
         WHERE pa.puzzle_id IN (SELECT puzzle_id FROM assignment_puzzles WHERE assignment_id = $1)
         GROUP BY pa.student_id
       ) agg ON agg.student_id = sub.student_id
       WHERE sub.assignment_id = $1
       ORDER BY u.name`,
      [assignmentId]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const students = subs.rows.map((r) => {
      // Overdue is derived, never stored: past due and not yet handed in.
      // Progress is derived from the attempts themselves rather than the stored
      // `progress_completed`, which can drift (it is only refreshed when a new
      // attempt is recorded, and older rows were seeded from a different source).
      const total = q.puzzle_count;
      const completed = Math.min(r.solved || 0, total);
      const status = effectiveStudentStatus({
        status: r.status,
        dueDate: q.due_date,
        solved: completed,
        total,
        today,
      });
      return {
        submissionId: r.submission_id,
        studentId: r.student_id,
        userId: r.user_id,
        name: r.student_name,
        email: r.email,
        status,
        progressCompleted: completed,
        progressTotal: total,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
        attemptCount: r.attempt_count,

        points: r.points,
        timeTaken: r.time_taken,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        score: r.score,
      };
    });

    res.json({ assignment: q, students });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle assignment students', error: err.message });
  }
};

/* GET /api/assignments/submissions/:submissionId/review — move-by-move review. */
exports.getPuzzleAssignmentReview = async (req, res) => {
  try {
    const submissionId = Number(req.params.submissionId);

    const head = await db.query(
      `SELECT sub.id AS submission_id, sub.status, sub.progress_completed, sub.submitted_at,
              sub.reviewed_at, sub.score, sub.feedback,
              a.id AS assignment_id, a.title AS assignment_title, a.due_date, a.max_attempts,
              sub.student_id, u.name AS student_name, u.email
       FROM assignment_submissions sub
       JOIN assignments a ON a.id = sub.assignment_id
       JOIN students s ON s.id = sub.student_id
       JOIN users u ON u.id = s.user_id
       WHERE sub.id = $1 AND a.type = 'puzzle_assignment'`,
      [submissionId]
    );
    if (head.rows.length === 0) return res.status(404).json({ message: 'Submission not found' });
    const h = head.rows[0];

    // Every puzzle in the assignment, in the coach's order.
    const puzzles = await db.query(
      `SELECT p.id, p.fen, p.solution, p.theme, p.themes, p.difficulty, p.explanation,
              p.points_value, ap.order_index
       FROM assignment_puzzles ap
       JOIN puzzles p ON p.id = ap.puzzle_id
       WHERE ap.assignment_id = $1
       ORDER BY ap.order_index, p.id`,
      [h.assignment_id]
    );

    // This student's attempts on THIS assignment's puzzles.
    //
    // A puzzle can belong to several assignments at once (the same set assigned
    // on different dates), but `puzzle_attempts.puzzle_assignment_id` can only
    // point at one of them. So filtering on that column alone hides real
    // attempts from the other assignments that contain the same puzzle.
    //
    // Instead: take the student's attempts on these puzzle ids, preferring any
    // explicitly linked to this assignment, and otherwise falling back to the
    // most recent unlinked attempt. That way a coach always sees what the
    // student actually did on the puzzle, whichever assignment it was recorded
    // against.
    const attempts = await db.query(
      `SELECT DISTINCT ON (pa.puzzle_id, pa.attempt_no)
              pa.id, pa.puzzle_id, pa.result, pa.score, pa.points_earned, pa.time_taken,
              pa.attempt_no, pa.attempted_at, pa.played_moves
       FROM puzzle_attempts pa
       WHERE pa.student_id = $2
         AND pa.puzzle_id IN (SELECT puzzle_id FROM assignment_puzzles WHERE assignment_id = $1)
       ORDER BY pa.puzzle_id, pa.attempt_no, pa.attempted_at`,
      [h.assignment_id, h.student_id]
    );

    const attemptsByPuzzle = {};
    for (const a of attempts.rows) (attemptsByPuzzle[a.puzzle_id] ||= []).push(a);

    const items = puzzles.rows.map((p) => {
      const correctSan = solutionToSan(p.fen, p.solution);
      const rows = (attemptsByPuzzle[p.id] || []).map((a) => ({
        attemptId: a.id,
        attemptNo: a.attempt_no,
        result: a.result,
        score: a.score,
        pointsEarned: a.points_earned || 0,
        timeTaken: a.time_taken,
        attemptedAt: a.attempted_at,
        moves: markMoves(p.fen, correctSan, a.played_moves),
      }));
      // The coach reviews the student's BEST attempt, not merely the last one.
      // A student who failed twice then solved it should read as Completed, and
      // a later failed retry must not erase an earlier success.
      const best = rows.reduce(
        (acc, r) => (r.result === 'correct' && acc?.result !== 'correct' ? r : acc || r),
        null
      );
      return {
        puzzleId: p.id,
        fen: p.fen,
        theme: p.theme,
        themes: p.themes || [],
        difficulty: p.difficulty,
        explanation: p.explanation,
        pointsValue: p.points_value == null ? 10 : p.points_value,
        orderIndex: p.order_index,
        correctMoves: correctSan,
        correctReplay: solutionReplay(p.fen, p.solution),
        attempts: rows,
        attemptCount: rows.length,
        isCorrect: rows.some((r) => r.result === 'correct'),
        // Best points win, so a failed retry after a solve cannot reduce the score.
        pointsEarned: rows.reduce((n, r) => Math.max(n, r.pointsEarned || 0), 0),
        timeTaken: best ? best.timeTaken : 0,
        moves: best ? best.moves : [],
      };
    });

    const totalPoints = items.reduce((n, i) => n + (i.pointsEarned || 0), 0);
    const totalTime = items.reduce((n, i) => n + (i.timeTaken || 0), 0);
    const solved = items.filter((i) => i.isCorrect).length;

    res.json({
      submission: {
        submissionId: h.submission_id,
        assignmentId: h.assignment_id,
        assignmentTitle: h.assignment_title,
        studentId: h.student_id,
        studentName: h.student_name,
        email: h.email,
        status: h.status,
        submittedAt: h.submitted_at,
        reviewedAt: h.reviewed_at,
        score: h.score,
        feedback: h.feedback,
        dueDate: h.due_date,
      },
      summary: {
        totalPoints,
        totalTime,
        puzzleCount: items.length,
        solvedCount: solved,
        accuracy: items.length > 0 ? Math.round((solved / items.length) * 100) : 0,
      },
      puzzles: items,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle assignment review', error: err.message });
  }
};

/* PATCH /api/assignments/submissions/:submissionId/review — mark reviewed. */
exports.markPuzzleAssignmentReviewed = async (req, res) => {
  try {
    const { score, feedback, status = 'reviewed' } = req.body;
    const result = await db.query(
      `UPDATE assignment_submissions
       SET status      = $1,
           score       = COALESCE($2, score),
           feedback    = COALESCE($3, feedback),
           reviewed_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        ['submitted', 'reviewed', 'in_progress'].includes(status) ? status : 'reviewed',
        score != null ? Number(score) : null,
        feedback || null,
        req.params.submissionId,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Submission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark submission reviewed', error: err.message });
  }
};



/* PATCH /api/assignments/puzzle-assignments/:id — update lifecycle fields. */
exports.updatePuzzleAssignment = async (req, res) => {
  try {
    const { title, description, status, dueDate, maxAttempts } = req.body;
    const result = await db.query(
      `UPDATE assignments SET
         title        = COALESCE($1, title),
         description  = COALESCE($2, description),
         status       = COALESCE($3, status),
         due_date     = COALESCE($4, due_date),
         max_attempts = COALESCE($5, max_attempts)
       WHERE id = $6 AND type = 'puzzle_assignment'
       RETURNING *`,
      [title || null, description || null, status || null, dueDate || null,
       maxAttempts != null ? Math.max(1, Number(maxAttempts) || 1) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Puzzle assignment not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update puzzle assignment', error: err.message });
  }
};

exports.listAssignments = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, c.title AS course_title FROM assignments a
       LEFT JOIN courses c ON c.id = a.course_id ORDER BY a.due_date ASC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list assignments', error: err.message });
  }
};

exports.getAssignment = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch assignment', error: err.message });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const { title, description, courseId, moduleId, dueDate, difficulty, fen, pgn, questions } = req.body;
    const result = await db.query(
      `INSERT INTO assignments (title, description, course_id, module_id, due_date, difficulty, fen, pgn, questions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title, description, courseId, moduleId, dueDate, difficulty || 'Medium', fen, pgn, JSON.stringify(questions || []), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create assignment', error: err.message });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const { title, description, dueDate, difficulty, fen, pgn, questions } = req.body;
    const result = await db.query(
      `UPDATE assignments SET title=COALESCE($1,title), description=COALESCE($2,description),
       due_date=COALESCE($3,due_date), difficulty=COALESCE($4,difficulty), fen=COALESCE($5,fen),
       pgn=COALESCE($6,pgn), questions=COALESCE($7,questions) WHERE id=$8 RETURNING *`,
      [title, description, dueDate, difficulty, fen, pgn, questions ? JSON.stringify(questions) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update assignment', error: err.message });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    await db.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
    res.json({ message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete assignment', error: err.message });
  }
};

exports.submitAssignment = async (req, res) => {
  try {
    const { answer, fileUrl, pgn } = req.body;
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const result = await db.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, answer, file_url, pgn)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET answer=EXCLUDED.answer, file_url=EXCLUDED.file_url, pgn=EXCLUDED.pgn, submitted_at=NOW()
       RETURNING *`,
      [req.params.id, studentId, answer, fileUrl, pgn]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit assignment', error: err.message });
  }
};

exports.getSubmissions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sub.*, u.name AS student_name FROM assignment_submissions sub
       JOIN students s ON s.id = sub.student_id JOIN users u ON u.id = s.user_id
       WHERE sub.assignment_id = $1 ORDER BY sub.submitted_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch submissions', error: err.message });
  }
};

exports.gradeSubmission = async (req, res) => {
  try {
    const { score, feedback, approved } = req.body;
    const result = await db.query(
      `UPDATE assignment_submissions SET score=$1, feedback=$2, approved=$3 WHERE id=$4 RETURNING *`,
      [score, feedback, approved || false, req.params.submissionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Submission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to grade submission', error: err.message });
  }
};
