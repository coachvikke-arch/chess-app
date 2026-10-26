const db = require('../config/database');
const { studentIdForUser } = require('./studentController');

/* ── Shared scope: a coach only sees their own students. A student belongs to
   a coach via students.coach_id (primary coach). Super admins see everything. */
function coachScope(user) {
  if (user.role === 'superadmin') return { clause: '', params: [] };
  const params = [user.id];
  return {
    clause: `s.coach_id = $${params.length}`,
    params,
  };
}

/* ── Original student dashboard ────────────────────────────────────────────── */
exports.studentDashboard = async (req, res) => {
  // delegate to studentController.getDashboard logic via require to avoid duplication
  const studentController = require('./studentController');
  return studentController.getDashboard(req, res);
};

/* ── Original coach dashboard ──────────────────────────────────────────────── */
exports.coachDashboard = async (req, res) => {
  try {
    const [totalStudents, upcomingClasses, pendingAssignments, submissions, avgPerformance, attendanceOverall] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM students'),
      db.query(`SELECT COUNT(*) AS count FROM classes WHERE class_date >= CURRENT_DATE`),
      db.query(`SELECT COUNT(*) AS count FROM assignments WHERE due_date >= CURRENT_DATE`),
      db.query(`SELECT COUNT(*) AS count FROM assignment_submissions WHERE score IS NULL`),
      db.query(`SELECT AVG(score)::int AS avg FROM assignment_submissions WHERE score IS NOT NULL`),
      db.query(`
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'present') AS present
        FROM attendance
      `),
    ]);

    const att = attendanceOverall.rows[0];
    const attendancePct = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;

    res.json({
      totalStudents: Number(totalStudents.rows[0].count),
      upcomingClasses: Number(upcomingClasses.rows[0].count),
      pendingAssignments: Number(pendingAssignments.rows[0].count),
      ungradedSubmissions: Number(submissions.rows[0].count),
      averagePerformance: avgPerformance.rows[0].avg || 0,
      attendancePercentage: attendancePct,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load coach dashboard', error: err.message });
  }
};

/* ── Original student-wise game analysis ───────────────────────────────────── */
// Student-wise game analysis from permanent per-student aggregation.
// Aggregates all period rows for each student into a summary; optional ?studentId= returns period breakdown.
exports.gameAnalysis = async (req, res) => {
  try {
    /* The summary row identifies a student by BOTH `user_id` (always present,
       it comes from the users join) and `student_id` (the students-table id,
       which is NULL for an account with no students row). The breakdown is
       therefore looked up by user id, so it can never miss the same row the
       summary listed. `studentId` is still accepted for older callers. */
    const raw = req.query.userId ?? req.query.studentId;
    const byUser = req.query.userId != null;
    const id = raw == null || raw === '' ? null : Number(raw);

    if (raw != null && raw !== '' && !Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid userId/studentId — must be an integer' });
    }

    if (id) {
      const detail = await db.query(
        `SELECT sa.period_start, sa.period_end, sa.games, sa.wins, sa.losses, sa.draws,
                sa.abandoned, sa.avg_moves, sa.created_at
         FROM student_game_analysis sa
         ${byUser ? '' : 'JOIN students s ON s.user_id = sa.student_user_id'}
         WHERE ${byUser ? 'sa.student_user_id' : 's.id'} = $1
         ORDER BY sa.period_start DESC
         LIMIT 60`,
        [id]
      );
      return res.json({ id, periods: detail.rows });
    }

    const result = await db.query(
      `SELECT u.id AS user_id, u.name, s.id AS student_id,
              COALESCE(SUM(sa.games),0)::int AS games,
              COALESCE(SUM(sa.wins),0)::int AS wins,
              COALESCE(SUM(sa.losses),0)::int AS losses,
              COALESCE(SUM(sa.draws),0)::int AS draws,
              COALESCE(SUM(sa.abandoned),0)::int AS abandoned,
              CASE WHEN SUM(sa.games) > 0
                   THEN ROUND((SUM(sa.avg_moves * sa.games) / NULLIF(SUM(sa.games),0))::numeric, 1)
                   ELSE 0 END AS avg_moves
         FROM student_game_analysis sa
         JOIN users u ON u.id = sa.student_user_id
         LEFT JOIN students s ON s.user_id = sa.student_user_id
         GROUP BY u.id, s.id
         ORDER BY games DESC, u.name ASC
         LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load game analysis', error: err.message });
  }
};

/* ── Student activity over time (daily active students) ───────────────────── */
exports.studentActivity = async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ message: 'Invalid days parameter' });
    }
    const { clause, params } = coachScope(req.user);
    const daysMinusOne = days - 1;
    const coachWhere = clause ? ` AND (${clause})` : '';
    const result = await db.query(
      `WITH student_days AS (
         /* Any student activity on a given day counts as "active". */
         SELECT DISTINCT s.id AS student_id, DATE(a.created_at) AS day
         FROM attendance a
          JOIN students s ON s.id = a.student_id
          WHERE a.created_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

         UNION
         SELECT DISTINCT pa.student_id, DATE(pa.attempted_at)
         FROM puzzle_attempts pa
          JOIN students s ON s.id = pa.student_id
          WHERE pa.attempted_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

         UNION
         SELECT DISTINCT sub.student_id, DATE(sub.submitted_at)
         FROM assignment_submissions sub
          JOIN students s ON s.id = sub.student_id
          WHERE sub.submitted_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

        ),
        daily AS (
          SELECT day, COUNT(DISTINCT student_id) AS active_students
          FROM student_days
          GROUP BY day
        ),
        all_days AS (
          SELECT generate_series(
            (CURRENT_DATE - INTERVAL '${daysMinusOne} days')::date,
            CURRENT_DATE::date,
            '1 day'
          )::date AS day
        )
        SELECT to_char(a.day, 'YYYY-MM-DD') AS date,
               COALESCE(d.active_students, 0) AS active_students
        FROM all_days a
        LEFT JOIN daily d ON d.day = a.day
        ORDER BY a.day
       `,
      params
    );
    res.json({ days, data: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load student activity', error: err.message });
  }
};

/* ── Assignment progress analytics ────────────────────────────────────────── */
exports.assignmentProgress = async (req, res) => {
  try {
    const { clause, params } = coachScope(req.user);
    const coachWhere = clause ? ` AND (${clause})` : '';
    const result = await db.query(
      `WITH coach_assignments AS (
         SELECT id, title, due_date
         FROM assignments
         WHERE created_by = $1
       ),
       submission_stats AS (
         SELECT
           COUNT(*) AS total_assigned,
           COUNT(*) FILTER (WHERE score IS NULL) AS in_progress,
           COUNT(*) FILTER (WHERE score IS NOT NULL) AS submitted,
           COUNT(*) FILTER (WHERE score IS NOT NULL AND approved) AS graded,
           COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND score IS NULL) AS overdue
         FROM coach_assignments ca
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = ca.id
       )
        SELECT
          total_assigned,
          in_progress,
          submitted,
          graded,
          overdue,
          CASE WHEN total_assigned > 0
            THEN ROUND(((submitted::numeric) / total_assigned) * 100, 1)
            ELSE 0 END AS completion_rate,
          CASE WHEN submitted > 0
            THEN ROUND(((graded::numeric) / submitted) * 100, 1)
            ELSE 0 END AS grading_rate
        FROM submission_stats
       `,
      [req.user.id]
    );
    res.json(result.rows[0] || {
      total_assigned: 0, in_progress: 0, submitted: 0, graded: 0, overdue: 0,
      completion_rate: 0, grading_rate: 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load assignment progress', error: err.message });
  }
};

/* ── Puzzle analytics ─────────────────────────────────────────────────────── */
exports.puzzleAnalytics = async (req, res) => {
  try {
    const { clause, params } = coachScope(req.user);
    const coachWhere = clause ? ` WHERE (${clause})` : '';
    const result = await db.query(
      `WITH coach_puzzle_attempts AS (
         SELECT pa.puzzle_id, pa.student_id, pa.result, pa.score, pa.attempted_at, p.theme, p.difficulty
         FROM puzzle_attempts pa
         JOIN puzzles p ON p.id = pa.puzzle_id
         JOIN students s ON s.id = pa.student_id
         ${coachWhere}
       ),
        totals AS (
          SELECT
            COUNT(*) AS total_attempts,
            COUNT(*) FILTER (WHERE result = 'correct') AS correct_attempts,
            COUNT(DISTINCT puzzle_id) AS unique_puzzles,
            COUNT(DISTINCT student_id) AS unique_students,
            ROUND(AVG(score)::numeric, 1) AS avg_score
          FROM coach_puzzle_attempts
        ),
        theme_stats AS (
          SELECT
            theme,
            COUNT(*) AS attempts,
            COUNT(*) FILTER (WHERE result = 'correct') AS correct,
            ROUND((COUNT(*) FILTER (WHERE result = 'correct')::numeric / COUNT(*)) * 100, 1) AS success_rate
          FROM coach_puzzle_attempts
          WHERE theme IS NOT NULL AND theme <> ''
          GROUP BY theme
          ORDER BY attempts DESC
          LIMIT 10
        )
        SELECT
          t.total_attempts,
          t.correct_attempts,
          t.unique_puzzles,
          t.unique_students,
          t.avg_score,
          ROUND((t.correct_attempts::numeric / NULLIF(t.total_attempts, 0)) * 100, 1) AS success_rate,
          COALESCE(json_agg(
            json_build_object(
              'theme', ts.theme,
              'attempts', ts.attempts,
              'correct', ts.correct,
              'success_rate', ts.success_rate
            ) ORDER BY ts.attempts DESC
          ) FILTER (WHERE ts.theme IS NOT NULL), '[]'::json) AS top_themes
        FROM totals t
        LEFT JOIN theme_stats ts ON true
        GROUP BY t.total_attempts, t.correct_attempts, t.unique_puzzles, t.unique_students, t.avg_score
       `,
      params
    );
    res.json(result.rows[0] || {
      total_attempts: 0, correct_attempts: 0, unique_puzzles: 0, unique_students: 0,
      avg_score: 0, success_rate: 0, top_themes: [],
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle analytics', error: err.message });
  }
};

/* ── Attendance analytics ─────────────────────────────────────────────────── */
exports.attendanceAnalytics = async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ message: 'Invalid days parameter' });
    }
    const { clause, params } = coachScope(req.user);
    const coachWhere = clause ? ` AND (${clause})` : '';
    const daysMinusOne = days - 1;
    const result = await db.query(
      `WITH coach_attendance AS (
         SELECT a.status, a.created_at::date AS day, a.student_id
         FROM attendance a
          JOIN students s ON s.id = a.student_id
          WHERE a.created_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

        ),
        daily AS (
          SELECT
            day,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'present') AS present,
            COUNT(*) FILTER (WHERE status = 'absent') AS absent,
            COUNT(*) FILTER (WHERE status = 'late') AS late
          FROM coach_attendance
          GROUP BY day
        ),
        all_days AS (
          SELECT generate_series(
            (CURRENT_DATE - INTERVAL '${daysMinusOne} days')::date,
            CURRENT_DATE::date,
            '1 day'
          )::date AS day
        )
        SELECT
          to_char(a.day, 'YYYY-MM-DD') AS date,
          COALESCE(d.total, 0) AS total,
          COALESCE(d.present, 0) AS present,
          COALESCE(d.absent, 0) AS absent,
          COALESCE(d.late, 0) AS late,
          CASE WHEN COALESCE(d.total, 0) > 0
            THEN ROUND(((COALESCE(d.present, 0))::numeric / d.total) * 100, 1)
            ELSE 0 END AS attendance_rate
        FROM all_days a
        LEFT JOIN daily d ON d.day = a.day
        ORDER BY a.day
       `,
      params
    );
    // Overall stats
    const overall = await db.query(
      `WITH coach_attendance AS (
         SELECT status
         FROM attendance a
          JOIN students s ON s.id = a.student_id
          WHERE a.created_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

        )
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'present') AS present,
          COUNT(*) FILTER (WHERE status = 'absent') AS absent,
          COUNT(*) FILTER (WHERE status = 'late') AS late
        FROM coach_attendance
       `,
      params
    );
    const o = overall.rows[0];
    const attendanceRate = o.total > 0 ? Math.round((o.present / o.total) * 100) : 0;
    res.json({
      days,
      data: result.rows,
      overall: {
        total: Number(o.total) || 0,
        present: Number(o.present) || 0,
        absent: Number(o.absent) || 0,
        late: Number(o.late) || 0,
        attendanceRate,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load attendance analytics', error: err.message });
  }
};

/* ── Chess performance analytics ──────────────────────────────────────────── */
exports.chessPerformance = async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ message: 'Invalid days parameter' });
    }
    const { clause, params } = coachScope(req.user);
    const coachWhere = clause ? ` AND (${clause})` : '';
    const daysMinusOne = days - 1;
    const result = await db.query(
      `WITH coach_games AS (
         SELECT og.result, og.created_at, og.white_ms, og.black_ms
         FROM online_games og
          JOIN students s ON s.user_id = og.student_id
          WHERE og.status = 'finished'
            AND og.created_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

        ),
        daily AS (
          SELECT
            DATE(created_at) AS day,
            COUNT(*) AS games,
            COUNT(*) FILTER (WHERE result = 'white') AS white_wins,
            COUNT(*) FILTER (WHERE result = 'black') AS black_wins,
            COUNT(*) FILTER (WHERE result = 'draw') AS draws,
            COUNT(*) FILTER (WHERE result = 'abandoned') AS abandoned
          FROM coach_games
          GROUP BY DATE(created_at)
        ),
        all_days AS (
          SELECT generate_series(
            (CURRENT_DATE - INTERVAL '${daysMinusOne} days')::date,
            CURRENT_DATE::date,
            '1 day'
          )::date AS day
        )
        SELECT
          to_char(a.day, 'YYYY-MM-DD') AS date,
          COALESCE(d.games, 0) AS games,
          COALESCE(d.white_wins, 0) AS white_wins,
          COALESCE(d.black_wins, 0) AS black_wins,
          COALESCE(d.draws, 0) AS draws,
          COALESCE(d.abandoned, 0) AS abandoned
        FROM all_days a
        LEFT JOIN daily d ON d.day = a.day
        ORDER BY a.day
       `,
      params
    );
    // Overall stats
    const overall = await db.query(
      `WITH coach_games AS (
         SELECT og.result
         FROM online_games og
          JOIN students s ON s.user_id = og.student_id
          WHERE og.status = 'finished'
            AND og.created_at >= NOW() - INTERVAL '${days} days'
          ${coachWhere}

        )
        SELECT
          COUNT(*) AS total_games,
          COUNT(*) FILTER (WHERE result = 'white') AS white_wins,
          COUNT(*) FILTER (WHERE result = 'black') AS black_wins,
          COUNT(*) FILTER (WHERE result = 'draw') AS draws,
          COUNT(*) FILTER (WHERE result = 'abandoned') AS abandoned
        FROM coach_games
       `,
      params
    );
    const o = overall.rows[0];
    const totalGames = Number(o.total_games) || 0;
    const totalDecisive = (Number(o.white_wins) || 0) + (Number(o.black_wins) || 0);
    res.json({
      days,
      data: result.rows,
      overall: {
        totalGames,
        whiteWins: Number(o.white_wins) || 0,
        blackWins: Number(o.black_wins) || 0,
        draws: Number(o.draws) || 0,
        abandoned: Number(o.abandoned) || 0,
        totalDecisive,
        whiteWinRate: totalDecisive > 0 ? Math.round(((Number(o.white_wins) || 0) / totalDecisive) * 100) : 0,
        blackWinRate: totalDecisive > 0 ? Math.round(((Number(o.black_wins) || 0) / totalDecisive) * 100) : 0,
        drawRate: totalGames > 0 ? Math.round((Number(o.draws) || 0) / totalGames * 100) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load chess performance', error: err.message });
  }
};