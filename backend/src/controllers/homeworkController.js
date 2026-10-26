const db = require('../config/database');
const { deriveStudentSubmissionStatus } = require('../utils/assignmentStatus');

/* Homework is a view over the EXISTING puzzle-assignment model:
     assignments(type='puzzle_assignment')
       → assignment_puzzles (ordered composition)
       → assignment_submissions (one row per student)
       → puzzle_attempts (puzzle_assignment_id links a try to one assignment)
   Nothing here writes a parallel table; every number is derived from those
   rows so the coach tracker, the student solver and this page always agree. */

const MAX_LIMIT = 50;

function pageParams(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

async function studentIdFor(userId) {
  const res = await db.query('SELECT id FROM students WHERE user_id = $1', [userId]);
  return res.rows[0]?.id ?? null;
}

/** Latest attempt per puzzle for one student, scoped to one assignment. */
const LATEST_ATTEMPT = `
  SELECT DISTINCT ON (pa.puzzle_id)
         pa.puzzle_id, pa.result, pa.attempted_at, pa.time_taken,
         pa.attempt_no, pa.score, pa.points_earned
  FROM puzzle_attempts pa
  WHERE pa.student_id = $2 AND pa.puzzle_assignment_id = $1
  ORDER BY pa.puzzle_id, pa.id DESC`;

/* ══════════════════════ student ══════════════════════ */

/* GET /api/student/homework?page=1&limit=10 */
exports.listStudentHomework = async (req, res) => {
  try {
    const studentId = await studentIdFor(req.user.id);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const { page, limit, offset } = pageParams(req.query);

    const result = await db.query(
      `SELECT sub.id AS submission_id, sub.assignment_id, sub.status AS stored_status,
              sub.submitted_at, sub.reviewed_at, sub.score,
              a.title, a.description, a.due_date, a.max_attempts, a.created_at,
              COALESCE(pc.total, 0)::int AS puzzle_count,
              COALESCE(pc.max_points, 0)::int AS max_score,
              COALESCE(agg.solved, 0)::int AS solved,
              COALESCE(agg.attempted, 0)::int AS attempted,
              COUNT(*) OVER()::int AS total_count
         FROM assignment_submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
         LEFT JOIN (
           SELECT ap.assignment_id,
                  COUNT(*)::int AS total,
                  COALESCE(SUM(p.points_value), 0)::int AS max_points
             FROM assignment_puzzles ap
             JOIN puzzles p ON p.id = ap.puzzle_id
            GROUP BY ap.assignment_id
         ) pc ON pc.assignment_id = a.id
         LEFT JOIN (
           SELECT t.puzzle_assignment_id AS assignment_id,
                  COUNT(*) FILTER (WHERE t.result = 'correct')::int AS solved,
                  COUNT(DISTINCT t.puzzle_id)::int AS attempted
             FROM (
               SELECT DISTINCT ON (pa.puzzle_id)
                      pa.puzzle_id, pa.puzzle_assignment_id, pa.result
                 FROM puzzle_attempts pa
                WHERE pa.student_id = $1 AND pa.puzzle_assignment_id IS NOT NULL
                ORDER BY pa.puzzle_id, pa.id DESC
             ) t
            GROUP BY t.puzzle_assignment_id
         ) agg ON agg.assignment_id = a.id
        WHERE sub.student_id = $1 AND a.type = 'puzzle_assignment'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    );

    /* COUNT(*) OVER() rides along with the page rows. An out-of-range page has
       no rows to carry it, so fall back to a plain count — otherwise the pager
       would be told "0 homework" and could not clamp back to a real page. */
    let total = result.rows[0]?.total_count ?? null;
    if (total == null) {
      const count = await db.query(
        `SELECT COUNT(*)::int AS n
           FROM assignment_submissions sub
           JOIN assignments a ON a.id = sub.assignment_id
          WHERE sub.student_id = $1 AND a.type = 'puzzle_assignment'`,
        [studentId]
      );
      total = count.rows[0]?.n ?? 0;
    }

    const items = result.rows.map((r) => {
      const puzzleCount = r.puzzle_count;
      const solved = Math.min(r.solved || 0, puzzleCount);
      const attempted = Math.min(Math.max(r.attempted || 0, solved), puzzleCount);
      const status = deriveStudentSubmissionStatus({
        storedStatus: r.stored_status,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        dueDate: r.due_date,
        storedScore: r.score,
        attemptedCount: attempted,
        solvedCount: solved,
        totalCount: puzzleCount,
      });
      return {
        assignmentId: r.assignment_id,
        submissionId: r.submission_id,
        title: r.title,
        description: r.description,
        dueDate: r.due_date,
        maxAttempts: r.max_attempts,
        createdAt: r.created_at,
        status,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        score: r.score,
        maxScore: r.max_score,
        puzzleCount,
        solved,
        attempted,
        progress: {
          solved,
          attempted,
          total: puzzleCount,
          pct: puzzleCount > 0 ? Math.round((solved / puzzleCount) * 100) : 0,
        },
      };
    });

    res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load homework', error: err.message });
  }
};

/* GET /api/student/homework/:id */
exports.getStudentHomework = async (req, res) => {
  try {
    const studentId = await studentIdFor(req.user.id);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId)) {
      return res.status(400).json({ message: 'Invalid homework id' });
    }

    const head = await db.query(
      `SELECT sub.id AS submission_id, sub.status AS stored_status,
              sub.submitted_at, sub.reviewed_at, sub.score,
              a.id AS assignment_id, a.title, a.description, a.due_date,
              a.max_attempts, a.created_at
         FROM assignment_submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.student_id = $1 AND sub.assignment_id = $2
          AND a.type = 'puzzle_assignment'`,
      [studentId, assignmentId]
    );
    if (head.rows.length === 0) {
      return res.status(404).json({ message: 'Homework not assigned to you' });
    }
    const h = head.rows[0];

    const puzzles = await db.query(
      `SELECT p.id, p.fen, p.theme, p.themes, p.difficulty, p.lichess_id,
              p.solution, p.explanation, p.points_value,
              s.name AS set_name, ap.order_index,
              COALESCE(pa.result, 'not_started') AS attempt_result,
              pa.attempted_at, pa.time_taken, pa.attempt_no,
              pa.score, pa.points_earned
         FROM assignment_puzzles ap
         JOIN puzzles p ON p.id = ap.puzzle_id
         LEFT JOIN sets s ON s.code = p.set_code
         LEFT JOIN LATERAL (${LATEST_ATTEMPT}) pa ON TRUE
        WHERE ap.assignment_id = $1
        ORDER BY ap.order_index, p.id`,
      [h.assignment_id, studentId]
    );

    const puzzleData = puzzles.rows.map((p) => ({
      id: p.id,
      fen: p.fen,
      theme: p.theme,
      themes: p.themes || [],
      difficulty: p.difficulty,
      lichess_id: p.lichess_id,
      solution: p.solution,
      explanation: p.explanation,
      pointsValue: p.points_value == null ? 10 : p.points_value,
      setName: p.set_name,
      orderIndex: p.order_index,
      attemptResult: p.attempt_result || 'not_started',
      attemptedAt: p.attempted_at,
      timeTaken: p.time_taken,
      attemptNo: p.attempt_no,
      score: p.score,
      pointsEarned: p.points_earned,
    }));

    const solved = puzzleData.filter((p) => p.attemptResult === 'correct').length;
    const attempted = puzzleData.filter((p) => p.attemptResult !== 'not_started').length;
    const total = puzzleData.length;
    const status = deriveStudentSubmissionStatus({
      storedStatus: h.stored_status,
      submittedAt: h.submitted_at,
      reviewedAt: h.reviewed_at,
      dueDate: h.due_date,
      storedScore: h.score,
      attemptedCount: attempted,
      solvedCount: solved,
      totalCount: total,
    });

    res.json({
      assignment: {
        assignmentId: h.assignment_id,
        submissionId: h.submission_id,
        title: h.title,
        description: h.description,
        dueDate: h.due_date,
        maxAttempts: h.max_attempts,
        createdAt: h.created_at,
        status,
        submittedAt: h.submitted_at,
        reviewedAt: h.reviewed_at,
        score: h.score,
        maxScore: puzzleData.reduce((n, p) => n + (p.pointsValue || 0), 0),
        locked: status === 'submitted' || status === 'reviewed',
        puzzles: puzzleData,
        progress: {
          solved,
          attempted,
          total,
          pct: total > 0 ? Math.round((solved / total) * 100) : 0,
          allAttempted: total > 0 && attempted >= total,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load homework', error: err.message });
  }
};

/* POST /api/student/homework/:id/progress
   The attempt itself is still recorded by POST /api/puzzles/:id/attempt (that
   is the one place that scores a move). This endpoint snapshots the resulting
   progress onto the submission so the student can leave and resume later, and
   refreshes the stored status without ever marking anything submitted. */
exports.saveStudentProgress = async (req, res) => {
  try {
    const studentId = await studentIdFor(req.user.id);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId)) {
      return res.status(400).json({ message: 'Invalid homework id' });
    }

    const sub = await db.query(
      `SELECT sub.id, sub.status, a.due_date
         FROM assignment_submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.student_id = $1 AND sub.assignment_id = $2
          AND a.type = 'puzzle_assignment'`,
      [studentId, assignmentId]
    );
    if (sub.rows.length === 0) {
      return res.status(404).json({ message: 'Homework not assigned to you' });
    }
    if (['submitted', 'reviewed'].includes(sub.rows[0].status)) {
      return res.status(409).json({ message: 'Homework already submitted', locked: true });
    }

    const agg = await db.query(
      `SELECT COUNT(DISTINCT t.puzzle_id) FILTER (WHERE t.result = 'correct')::int AS solved,
              COUNT(DISTINCT t.puzzle_id)::int AS attempted
         FROM (
           SELECT DISTINCT ON (pa.puzzle_id) pa.puzzle_id, pa.result
             FROM puzzle_attempts pa
            WHERE pa.student_id = $2 AND pa.puzzle_assignment_id = $1
            ORDER BY pa.puzzle_id, pa.id DESC
         ) t`,
      [assignmentId, studentId]
    );
    const solved = agg.rows[0]?.solved || 0;
    const attempted = agg.rows[0]?.attempted || 0;

    const totalRes = await db.query(
      'SELECT COUNT(*)::int AS n FROM assignment_puzzles WHERE assignment_id = $1',
      [assignmentId]
    );
    const total = totalRes.rows[0]?.n || 0;

    await db.query(
      `UPDATE assignment_submissions
          SET progress_completed = $1,
              status = CASE WHEN status = 'pending' AND $2::int > 0
                            THEN 'in_progress' ELSE status END
        WHERE student_id = $3 AND assignment_id = $4`,
      [solved, attempted, studentId, assignmentId]
    );

    const status = deriveStudentSubmissionStatus({
      storedStatus: sub.rows[0].status,
      submittedAt: null,
      reviewedAt: null,
      dueDate: sub.rows[0].due_date,
      attemptedCount: attempted,
      solvedCount: solved,
      totalCount: total,
    });

    res.json({
      progress: {
        solved,
        attempted,
        total,
        pct: total > 0 ? Math.round((solved / total) * 100) : 0,
      },
      status,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save homework progress', error: err.message });
  }
};

/* ══════════════════════ admin ══════════════════════ */

/* GET /api/homework?page=1&limit=10 */
exports.listHomework = async (req, res) => {
  try {
    const { page, limit, offset } = pageParams(req.query);

    const result = await db.query(
      `SELECT a.id, a.title, a.description, a.status, a.due_date, a.created_at,
              a.max_attempts, a.puzzle_set_code, s.name AS set_name,
              (SELECT COUNT(*)::int FROM assignment_puzzles ap
                WHERE ap.assignment_id = a.id) AS puzzle_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id) AS student_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id
                  AND sub.status IN ('submitted','reviewed')) AS submitted_count,
              COUNT(*) OVER()::int AS total_count
         FROM assignments a
         LEFT JOIN sets s ON s.code = a.puzzle_set_code
        WHERE a.type = 'puzzle_assignment'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    let total = result.rows[0]?.total_count ?? null;
    if (total == null) {
      const count = await db.query(
        `SELECT COUNT(*)::int AS n FROM assignments WHERE type = 'puzzle_assignment'`
      );
      total = count.rows[0]?.n ?? 0;
    }

    const items = result.rows.map((r) => ({
      assignmentId: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      dueDate: r.due_date,
      createdAt: r.created_at,
      maxAttempts: r.max_attempts,
      setName: r.set_name,
      setCode: r.puzzle_set_code,
      puzzleCount: r.puzzle_count,
      studentCount: r.student_count,
      submittedCount: r.submitted_count,
      completionPct: r.student_count > 0
        ? Math.round((r.submitted_count / r.student_count) * 100)
        : 0,
    }));

    res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load homework', error: err.message });
  }
};
