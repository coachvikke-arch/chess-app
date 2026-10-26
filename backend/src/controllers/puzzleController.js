const crypto = require('crypto');
const db = require('../config/database');
const { pool } = require('../config/database');
const { Chess } = require('chess.js');
const { isAdminRole } = require('../middleware/roleMiddleware');
const { deriveStudentSubmissionStatus } = require('../utils/assignmentStatus');

/* ───────────────────── lichess theme taxonomy ───────────────────── */

const LICHESS_CATEGORIES = {
  'Recommended': { label: 'Recommended', icon: '★', themes: ['fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'hangingPiece', 'trappedPiece', 'deflection', 'attraction', 'backRankMate', 'mateIn1', 'mateIn2', 'mateIn3'] },
  'Phases': { label: 'Game Phases', icon: '♟', themes: ['opening', 'middlegame', 'endgame', 'rookEndgame', 'bishopEndgame', 'pawnEndgame', 'knightEndgame', 'queenEndgame', 'queenEndgame'] },
  'Motifs': { label: 'Tactical Motifs', icon: '⚔', themes: ['fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'doubleCheck', 'trappedPiece', 'deflection', 'attraction', 'intermezzo', 'xrayAttack', 'zugzwang', 'hangingPiece', 'capturedDefender', 'clearance', 'quietMove', 'backRankMate', 'exposedKing', 'kingsideAttack', 'queensideAttack', 'advancedPawn', 'attackingF2F7'] },
  'Mates': { label: 'Checkmate Patterns', icon: '♛', themes: ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'backRankMate', 'anastasMate', 'arabianMate', 'bodenMate', 'hookMate', 'smotheredMate', 'operaMate', 'dovetailMate', 'epauletteMate', 'swallowTailMate', 'cornerMate', 'killBoxMate', 'triangleMate', 'vukovicMate', 'balestraMate', 'blindSwineMate', 'doubleBishopMate', 'pillsburyMate', 'morphyMate'] },
  'Goals': { label: 'Puzzle Goals', icon: '🎯', themes: ['equality', 'advantage', 'crushing'] },
  'Lengths': { label: 'Puzzle Length', icon: '📐', themes: ['oneMove', 'short', 'long', 'veryLong'] },
};

const DIFFICULTY_MAP = { fork: 'Fork', pin: 'Pin', skewer: 'Skewer', sacrifice: 'Sacrifice', discoveredAttack: 'Discovered Attack', doubleCheck: 'Double Check', trappedPiece: 'Trapped Piece', deflection: 'Deflection', attraction: 'Attraction', intermezzo: 'Intermezzo', xrayAttack: 'X-Ray Attack', zugzwang: 'Zugzwang', hangingPiece: 'Hanging Piece', capturedDefender: 'Capture Defender', backRankMate: 'Back-Rank Mate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5', promotion: 'Promotion', enPassant: 'En Passant', castling: 'Castling', advancedPawn: 'Advanced Pawn', attackingF2F7: 'Attacking f2/f7', exposedKing: 'Exposed King', kingsideAttack: 'Kingside Attack', queensideAttack: 'Queenside Attack', equality: 'Equality', advantage: 'Advantage', crushing: 'Crushing', opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame', oneMove: 'One-Move', shortPuzzle: 'Short', short: 'Short', longPuzzle: 'Long', long: 'Long', veryLong: 'Very Long' };

/* Matches UCI long algebraic notation (e.g. e2e4, g7g8q). SAN contains letters like N, Q, +, #, x, O-O. */
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Normalize a solution (array of SAN or UCI moves) to an array of UCI moves
 * by replaying them from `fen`. Throws if any move is illegal.
 */
function toUCI(fen, moves) {
  const game = new Chess(fen);
  const out = [];
  for (const m of Array.isArray(moves) ? moves : String(moves ?? '').split(/[\s,]+/).filter(Boolean)) {
    let applied;
    const token = String(m).trim();
    if (UCI_RE.test(token)) {
      applied = game.move({
        from: token.slice(0, 2),
        to: token.slice(2, 4),
        promotion: token.length > 4 ? token[4] : undefined,
      });
    } else {
      applied = game.move(token);
    }
    if (!applied) throw new Error(`Illegal move: ${token}`);
    out.push(applied.from + applied.to + (applied.promotion || ''));
  }
  return out;
}

/* ──────────────────── list with pagination ──────────────────── */

exports.listPuzzles = async (req, res) => {
  try {
    const { theme, difficulty, search, page = 1, limit = 50, sort = 'id' } = req.query;
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

    const whereParts = ['1=1'];
    const params = [];

    if (theme) {
      params.push(theme);
      whereParts.push(`($${params.length} = ANY(themes) OR theme = $${params.length})`);
    }
    if (difficulty) {
      params.push(difficulty);
      whereParts.push(`difficulty = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      whereParts.push(`(fen ILIKE $${params.length} OR theme ILIKE $${params.length} OR lichess_id ILIKE $${params.length})`);
    }

    // Admin/superadmin sees every puzzle. Students see all published puzzles (publish = visible to everyone).
    // For students, also report whether they've attempted/solved each puzzle.
    const isAdmin = isAdminRole(req.user?.role);
    let selectExtra = '';
    let studentId = null;
    if (!isAdmin) {
      const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
      if (studentRes.rows.length === 0) return res.json({ puzzles: [], total: 0, page: Number(page), limit: Number(limit) });
      studentId = studentRes.rows[0].id;
      whereParts.push('is_published = true');
    }

    const where = 'WHERE ' + whereParts.join(' AND ');

    // Count uses only the filter params (theme/difficulty/search).
    const countRes = await db.query(`SELECT COUNT(*) FROM puzzles ${where}`, params);
    const total = Number(countRes.rows[0].count);

    const sortCol = ['id', 'nb_plays', 'popularity', 'created_at'].includes(sort) ? sort : 'id';

    // Data query params: filters, then (for students) the student id used in solve subqueries, then limit/offset.
    const dataParams = [...params];
    const sp = dataParams.length + 1; // placeholder position of studentId
    if (!isAdmin) {
      dataParams.push(studentId);
      selectExtra = `,
        EXISTS(SELECT 1 FROM puzzle_attempts a1 WHERE a1.puzzle_id = puzzles.id AND a1.student_id = $${sp}) AS attempted,
        EXISTS(SELECT 1 FROM puzzle_attempts a1 WHERE a1.puzzle_id = puzzles.id AND a1.student_id = $${sp} AND a1.result = 'correct') AS solved`;
    }
    dataParams.push(Number(limit));
    const limitParam = dataParams.length;
    dataParams.push(offset);
    const result = await db.query(
      `SELECT id, fen, theme, themes, difficulty, nb_plays, popularity, lichess_id, game_url, solution, is_published, explanation, created_at${selectExtra}
       FROM puzzles ${where}
       ORDER BY ${sortCol} DESC
       LIMIT $${limitParam} OFFSET $${dataParams.length}`,
      dataParams
    );

    res.json({ puzzles: result.rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list puzzles', error: err.message });
  }
};

/* ──────────────── puzzles assigned to the logged-in student (with status) ────────────────
   Canonical visibility model for students (see student_puzzle_assignments):
   a puzzle appears here only when BOTH
     1) it has a per-student row in `student_puzzle_assignments`
        (created by AssignModal → POST /puzzles/assign-to-students), and
     2) it is `is_published` (admins publish on assignment).
   Every returned puzzle carries solved / attempted so the client can show
   status: not-started / in-progress / completed. */
exports.listStudentAssignedPuzzles = async (req, res) => {
  try {
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const result = await db.query(
      `WITH assigned AS (
         SELECT spa.puzzle_id, spa.status, spa.due_date, spa.notes, spa.assigned_date, spa.id AS assignment_id,
                spa.time_limit_seconds, spa.points, spa.max_attempts, spa.negative_points
         FROM student_puzzle_assignments spa
         WHERE spa.student_id = $1
         UNION
         SELECT pa.puzzle_id, 'assigned' AS status, NULL::date AS due_date, NULL::text AS notes,
                COALESCE(pa.assigned_at::date, CURRENT_DATE) AS assigned_date, pa.id AS assignment_id,
                NULL::integer AS time_limit_seconds, 10::integer AS points, NULL::integer AS max_attempts,
                0::integer AS negative_points
         FROM puzzle_assignments pa
         WHERE (pa.student_id = $1 OR pa.student_id IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM student_puzzle_assignments spa2
             WHERE spa2.student_id = $1 AND spa2.puzzle_id = pa.puzzle_id
           )
       )
       SELECT
         a.puzzle_id,
         p.fen, p.theme, p.themes, p.difficulty, p.lichess_id, p.nb_plays,
         p.solution, p.is_published, p.created_at, p.set_code,
         s.name AS set_name, s.type_tag,
         (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq,
         a.status, a.due_date, a.notes, a.assigned_date,
         a.time_limit_seconds, a.points, a.max_attempts, a.negative_points,
         EXISTS(SELECT 1 FROM puzzle_attempts a1
                WHERE a1.puzzle_id = p.id AND a1.student_id = $1) AS attempted,
         EXISTS(SELECT 1 FROM puzzle_attempts a1
                WHERE a1.puzzle_id = p.id AND a1.student_id = $1 AND a1.result = 'correct') AS solved,
         (SELECT COUNT(*) FROM puzzle_attempts a2
          WHERE a2.puzzle_id = p.id AND a2.student_id = $1) AS attempts_used
       FROM assigned a
       JOIN puzzles p ON p.id = a.puzzle_id
       LEFT JOIN sets s ON s.code = p.set_code
       WHERE p.is_published = true
       ORDER BY a.assigned_date DESC, a.assignment_id DESC`,
      [studentId]
    );

    const puzzles = result.rows.map((r) => ({
      id: r.puzzle_id,
      fen: r.fen,
      theme: r.theme,
      themes: r.themes || [],
      difficulty: r.difficulty,
      lichess_id: r.lichess_id,
      nb_plays: r.nb_plays,
      solution: r.solution,
      is_published: r.is_published,
      set_code: r.set_code,
      set_name: r.set_name,
      typeTag: r.type_tag,
      seq: r.seq,
      // Derived from live set_name + sequence number so a set rename is
      // automatically reflected everywhere the title is shown.
      title: r.set_name ? `${r.set_name} - ${r.seq}` : null,
      status: r.status || 'assigned',
      due_date: r.due_date,
      notes: r.notes,
      assigned_date: r.assigned_date,
      attempted: r.attempted,
      solved: r.solved,
      timeLimitSeconds: r.time_limit_seconds,
      points: r.points,
      maxAttempts: r.max_attempts,
      negativePoints: r.negative_points,
      attemptsUsed: r.attempts_used,
    }));

    res.json({ puzzles, total: puzzles.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load assigned puzzles', error: err.message });
  }
};

/* ──────────────── student: list my puzzle assignments (new system) ────────────────
   Returns the student's puzzle assignments from the new assignment system
   (assignment_submissions + assignment_puzzles), grouped by assignment. */
exports.listStudentPuzzleAssignments = async (req, res) => {
  try {
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    // Get all assignment submissions for this student
    const subs = await db.query(
      `SELECT sub.id AS submission_id, sub.assignment_id, sub.status, sub.submitted_at,
              sub.reviewed_at, sub.score, a.id AS assignment_id, a.title, a.description,
              a.due_date, a.max_attempts, a.created_at
        FROM assignment_submissions sub
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.student_id = $1 AND a.type = 'puzzle_assignment'
        ORDER BY a.created_at DESC`,
      [studentId]
    );

    const assignments = [];

    for (const sub of subs.rows) {
      // Get all puzzles in this assignment with the student's LATEST attempt.
      // The join is scoped to the student AND this exact assignment (the old
      // query swapped $1/$2, so attempts never matched and every puzzle read as
      // never started). A puzzle can be shared between assignments and a student
      // can retry a puzzle, so LATERAL picks the most recent attempt per puzzle.
      const puzzles = await db.query(
        `SELECT p.id, p.fen, p.theme, p.themes, p.difficulty, p.lichess_id,
                p.solution, p.explanation, p.points_value,
                s.name AS set_name,
                ap.order_index,
                COALESCE(pa.result, 'not_started') AS attempt_result,
                pa.attempted_at,
                pa.time_taken,
                pa.attempt_no,
                pa.score,
                pa.points_earned
          FROM assignment_puzzles ap
          JOIN puzzles p ON p.id = ap.puzzle_id
          LEFT JOIN sets s ON s.code = p.set_code
          LEFT JOIN LATERAL (
            SELECT pa.result, pa.attempted_at, pa.time_taken, pa.attempt_no,
                   pa.score, pa.points_earned
            FROM puzzle_attempts pa
            WHERE pa.student_id = $2
              AND pa.puzzle_assignment_id = $1
              AND pa.puzzle_id = p.id
            ORDER BY pa.id DESC
            LIMIT 1
          ) pa ON TRUE
          WHERE ap.assignment_id = $1
          ORDER BY ap.order_index, p.id`,
        [sub.assignment_id, studentId]
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

      // Status is derived from the authoritative timestamps + attempt data, so
      // a stale stored status (e.g. one written by the old attemptPuzzle bug)
      // can never pretend a submission happened. See utils/assignmentStatus.js.
      const status = deriveStudentSubmissionStatus({
        storedStatus: sub.status,
        submittedAt: sub.submitted_at,
        reviewedAt: sub.reviewed_at,
        dueDate: sub.due_date,
        storedScore: sub.score,
        attemptedCount: attempted,
        solvedCount: solved,
        totalCount: total,
      });

      assignments.push({
        assignmentId: sub.assignment_id,
        submissionId: sub.submission_id,
        title: sub.title,
        description: sub.description,
        dueDate: sub.due_date,
        maxAttempts: sub.max_attempts,
        createdAt: sub.created_at,
        status,
        submittedAt: sub.submitted_at,
        reviewedAt: sub.reviewed_at,
        puzzles: puzzleData,
        progress: {
          solved,
          attempted,
          total,
          pct: total > 0 ? Math.round((solved / total) * 100) : 0,
          allAttempted: total > 0 && attempted >= total,
          allSolved: total > 0 && solved >= total,
        },
      });
    }

    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle assignments', error: err.message });
  }
};

/* ──────────────── student: submit a puzzle assignment ──────────────── */
exports.submitPuzzleAssignment = async (req, res) => {
  try {
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const assignmentId = Number(req.params.id);

    // Verify the submission exists and belongs to this student. The old query
    // compared `sub.id` against the student id, so it never matched and every
    // submit 404'd.
    const sub = await db.query(
      `SELECT sub.id AS submission_id, sub.assignment_id, sub.status,
              a.due_date, a.max_attempts, a.title
        FROM assignment_submissions sub
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.student_id = $1 AND sub.assignment_id = $2`,
      [studentId, assignmentId]
    );

    if (sub.rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });

    const submission = sub.rows[0];

    if (submission.status === 'submitted' || submission.status === 'reviewed') {
      // Idempotent: a re-sent submit (double click, retried request, another
      // tab) reports the existing hand-in instead of erroring, so the UI can
      // treat both paths as "it worked".
      return res.json({
        message: 'Assignment already submitted',
        alreadySubmitted: true,
        submission,
      });
    }

    // Get all puzzles in the assignment and the student's latest attempt per
    // puzzle (scoped to THIS assignment — again fixing the swapped $1/$2).
    const puzzles = await db.query(
      `SELECT p.id, p.fen, p.solution, p.points_value,
              ap.order_index,
              COALESCE(pa.result, 'not_started') AS attempt_result,
              pa.score, pa.points_earned, pa.time_taken
        FROM assignment_puzzles ap
        JOIN puzzles p ON p.id = ap.puzzle_id
        LEFT JOIN LATERAL (
          SELECT pa.result, pa.score, pa.points_earned, pa.time_taken
          FROM puzzle_attempts pa
          WHERE pa.student_id = $2
            AND pa.puzzle_assignment_id = $1
            AND pa.puzzle_id = p.id
          ORDER BY pa.id DESC
          LIMIT 1
        ) pa ON TRUE
        WHERE ap.assignment_id = $1
        ORDER BY ap.order_index, p.id`,
      [submission.assignment_id, studentId]
    );

    const puzzlesData = puzzles.rows.map((p) => {
      let solution = p.solution;
      try { solution = toUCI(p.fen, p.solution); } catch { /* keep as-is */ }
      return {
        id: p.id,
        fen: p.fen,
        solution,
        pointsValue: p.points_value == null ? 10 : p.points_value,
        orderIndex: p.order_index,
        attemptResult: p.attempt_result || 'not_started',
        pointsEarned: p.points_earned,
        timeTaken: p.time_taken,
      };
    });

    // Check if all puzzles have been attempted
    const notAttempted = puzzlesData.filter((p) => p.attemptResult === 'not_started');
    if (notAttempted.length > 0) {
      return res.status(400).json({
        message: `Cannot submit: ${notAttempted.length} puzzle(s) not yet attempted`,
        notAttempted: notAttempted.map((p) => p.id),
      });
    }

    // Calculate score and results from the same latest-attempt-per-puzzle data
    // the list endpoint shows, so the card and the submission can never disagree
    // (the old query re-read attempts without ordering, so "is it solved" was
    // whichever puzzle_attempts row landed last in a Map).
    let totalPoints = 0;
    let totalTime = 0;
    let solved = 0;

    for (const p of puzzlesData) {
      if (p.attemptResult === 'correct') {
        solved++;
        totalPoints += p.pointsEarned || 0;
      }
      totalTime += p.timeTaken || 0;
    }

    // Update the submission. Uses the submission's own id (the old query used
    // the ASSIGNMENT id here, so no row matched) and stores the real hand-in
    // timestamp. progress_completed = puzzles correctly solved, matching the
    // attempt flow and the coach tracker.
    const updated = await db.query(
      `UPDATE assignment_submissions
       SET status = 'submitted',
           submitted_at = NOW(),
           score = $1,
           progress_completed = $2
       WHERE id = $3
       RETURNING *`,
      [totalPoints, solved, submission.submission_id]
    );

    // Also update each student_puzzle_assignments row to completed.
    // NOTE: student_puzzle_assignments.student_id references students(id), so
    // the students.id value must be used, not req.user.id.
    await db.query(
      `UPDATE student_puzzle_assignments spa
       SET status = 'completed'
       WHERE spa.student_id = $1
         AND spa.puzzle_id IN (SELECT puzzle_id FROM assignment_puzzles WHERE assignment_id = $2)
         AND spa.status <> 'completed'`,
      [studentId, req.params.id]
    );

    res.json({
      message: 'Assignment submitted successfully',
      submission: {
        submissionId: updated.rows[0].id,
        assignmentId: assignmentId,
        status: 'submitted',
        submittedAt: updated.rows[0].submitted_at,
        score: updated.rows[0].score,
        totalPuzzles: puzzlesData.length,
        solved,
        totalPoints,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit assignment', error: err.message });
  }
};

/* ──────────────── puzzle sets + scoped fetching (admin) ────────────────
   Sets are now a first-class, persistently stored concept (see the `sets`
   table + `puzzles.set_code` migration) instead of being derived at run time.
   Each set maps 1:1 to a theme type tag (e.g. "EG" = Endgame), so the former
   "(Type) (Level)" variants all merge into a single combined set.
   - set_code  stable deterministic code from the type tag, e.g. EG27
   - set_name  human-readable type label, e.g. "Endgame" (editable via PATCH)
   Puzzle cards reuse the existing conversion (uci/san replay, seq, title). */

const TYPE_SETS = [
  { tag: 'CM', label: 'Checkmate', slugs: ['mate', 'matein1', 'matein2', 'matein3', 'matein4', 'matein5', 'backrankmate', 'smotheredmate', 'operamate', 'hookmate', 'dovetailmate', 'anastasiamate', 'arabianmate', 'bodenmate', 'doublebishopmate', 'morphymate', 'pillsburymate', 'blindswinemate', 'trianglemate', 'vukovicmate', 'balestramate', 'epaulettemate', 'swallowtailmate', 'corner'] },
  { tag: 'FO', label: 'Fork', slugs: ['fork'] },
  { tag: 'PN', label: 'Pin', slugs: ['pin'] },
  { tag: 'SK', label: 'Skewer', slugs: ['skewer'] },
  { tag: 'SA', label: 'Sacrifice', slugs: ['sacrifice'] },
  { tag: 'DA', label: 'Discovered Attack', slugs: ['discoveredattack', 'discovered'] },
  { tag: 'DC', label: 'Double Check', slugs: ['doublecheck', 'double'] },
  { tag: 'TP', label: 'Trapped Piece', slugs: ['trappedpiece', 'trapped'] },
  { tag: 'DF', label: 'Deflection', slugs: ['deflection'] },
  { tag: 'AT', label: 'Attraction', slugs: ['attraction'] },
  { tag: 'IN', label: 'Intermezzo', slugs: ['intermezzo'] },
  { tag: 'XR', label: 'X-Ray Attack', slugs: ['xrayattack', 'xray'] },
  { tag: 'ZU', label: 'Zugzwang', slugs: ['zugzwang'] },
  { tag: 'HG', label: 'Hanging Piece', slugs: ['hangingpiece', 'hanging'] },
  { tag: 'CD', label: 'Capture Defender', slugs: ['captureddefender', 'capturedefender', 'capturingdefender'] },
  { tag: 'CL', label: 'Clearance', slugs: ['clearance'] },
  { tag: 'QM', label: 'Quiet Move', slugs: ['quietmove', 'quiet'] },
  { tag: 'PR', label: 'Promotion', slugs: ['promotion', 'underpromotion'] },
  { tag: 'EP', label: 'En Passant', slugs: ['enpassant', 'enpassant'] },
  { tag: 'CS', label: 'Castling', slugs: ['castling'] },
  { tag: 'AP', label: 'Advanced Pawn', slugs: ['advancedpawn', 'advanced'] },
  { tag: 'AF', label: 'Attacking f2/f7', slugs: ['attackingf2f7', 'attacking'] },
  { tag: 'EK', label: 'Exposed King', slugs: ['exposedking', 'exposedking'] },
  { tag: 'KS', label: 'Kingside Attack', slugs: ['kingsideattack', 'kingside'] },
  { tag: 'QS', label: 'Queenside Attack', slugs: ['queensideattack', 'queenside'] },
  { tag: 'OP', label: 'Opening', slugs: ['opening'] },
  { tag: 'MG', label: 'Middlegame', slugs: ['middlegame'] },
  { tag: 'EG', label: 'Endgame', slugs: ['endgame', 'rookendgame', 'bishopendgame', 'pawnendgame', 'knightendgame', 'queenendgame'] },
  { tag: 'AV', label: 'Advantage', slugs: ['advantage'] },
  { tag: 'CR', label: 'Crushing', slugs: ['crushing'] },
  { tag: 'EQ', label: 'Equality', slugs: ['equality'] },
  { tag: 'ST', label: 'Short Puzzle', slugs: ['short', 'shortpuzzle', 'onemove', 'one'] },
  { tag: 'LG', label: 'Long Puzzle', slugs: ['long', 'longpuzzle', 'verylong', 'very'] },
];

function puzzleTypeFromTheme(theme) {
  const t = String(theme || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const set of TYPE_SETS) {
    if (set.slugs.includes(t)) return set;
  }
  return { tag: 'TK', label: 'Tactics' };
}

/* Stable set code per type tag: tag + zero-padded index in TYPE_SETS.
   Deterministic and re-runnable, so re-imports, merges and backfills always
   agree on the same code for the same thematic set. */
function codeForTag(tag) {
  const idx = TYPE_SETS.findIndex((t) => t.tag === tag);
  const n = idx >= 0 ? idx + 1 : TYPE_SETS.length + 1;
  return `${tag}${String(n).padStart(2, '0')}`;
}

/* Human label for a tag (e.g. "EG" -> "Endgame"), mirroring puzzleTypeFromTheme. */
function labelForTag(tag) {
  return TYPE_SETS.find((t) => t.tag === tag)?.label || 'Tactics';
}

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

// Set metadata straight from the sets table, with live puzzle counts.
// One row per set; empty sets are kept so they stay visible and renamable.
async function loadSets() {
  const result = await db.query(
    `SELECT s.code AS set_code, s.name AS set_name, s.type_tag, s.folder_id,
            COUNT(p.id)::int AS count
     FROM sets s
     LEFT JOIN puzzles p ON p.set_code = s.code
     GROUP BY s.code, s.name, s.type_tag, s.folder_id
     ORDER BY s.name ASC`
  );
  return result.rows.map((r) => ({
    set_code: r.set_code,
    set_name: r.set_name,
    type: labelForTag(r.type_tag),
    typeTag: r.type_tag,
    level: null, // sets are merged across difficulty levels now
    count: r.count,
    folder_id: r.folder_id,
  }));
}

/* Make sure a `sets` row exists for every type tag present in the puzzles
   table and that every puzzle has its set_code backfilled. Idempotent +
   additive: it never deletes sets, never overwrites an existing set name (so
   admin renames survive), and only writes set_code on rows that don't have
   one yet. Accepts an optional db handle so it can run inside an import
   transaction; defaults to the shared pool. */
async function syncPuzzleSets(dbHandle) {
  const client = dbHandle || pool;
  const res = await client.query(
    'SELECT id, theme, themes, difficulty, set_code FROM puzzles'
  );
  const tags = new Map(); // tag -> { label, ids: [] }
  for (const p of res.rows) {
    const type = puzzleTypeFromTheme(p.theme || (p.themes && p.themes[0]) || '');
    if (!tags.has(type.tag)) tags.set(type.tag, { label: type.label, ids: [] });
    if (!p.set_code) tags.get(type.tag).ids.push(p.id);
  }

  for (const [tag, { label }] of tags) {
    await client.query(
      `INSERT INTO sets (code, name, type_tag) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [codeForTag(tag), label, tag]
    );
  }

  for (const [tag, { ids }] of tags) {
    if (ids.length === 0) continue;
    await client.query(
      'UPDATE puzzles SET set_code = $1 WHERE id = ANY($2)',
      [codeForTag(tag), ids]
    );
  }
}

// Row -> card with uci/san replay, per-set seq and the name-first title.
// `set` carries set_code/set_name/type/typeTag/level for the puzzle's set.
function cardFromRow(p, set, seq) {
  let uci = [];
  let san = [];
  try {
    uci = toUCI(p.fen, p.solution);
    const g = new Chess(p.fen);
    san = uci.map((m) => {
      const mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined });
      return mv ? mv.san : m;
    });
  } catch { /* keep empty on malformed rows */ }

  return {
    id: p.id,
    fen: p.fen,
    lichess_id: p.lichess_id,
    theme: p.theme,
    themes: p.themes || [],
    difficulty: p.difficulty,
    nb_plays: p.nb_plays,
    explanation: p.explanation,
    is_published: p.is_published,
    title: p.title || `${set.set_name} - ${seq}`,
    order_index: p.order_index != null ? p.order_index : seq,
    rating: p.rating != null ? p.rating : null,
    uci,
    san,
    set_code: set.set_code,
    set_name: set.set_name,
    type: set.type,
    typeTag: set.typeTag,
    level: set.level,
    seq,
  };
}

/* ── cheap change-signal for ETag/304 handling ─────────────────────────────
   Puzzles and sets change rarely, so we never want the full set read + every
   puzzle's chess.js replay to happen before we decide a cached response is
   still valid. `loadSetVersion` returns everything the ETag needs in ONE
   tiny index-backed query (sets PK + puzzles (set_code,id) / (set_code,
   updated_at)), so a 304 revalidation costs ~0-2ms even on the largest set.
   Signature fields:
     count        any puzzle added/removed in the set
     max_id       newest row id (covers inserts / auto-increment)
     last_change  MAX(puzzles.updated_at) — every UPDATE runs the auto-bump
                  trigger, so publish toggles / content edits invalidate too
     set row      name/type_tag/updated_at — renames and set edits invalidate */
function loadSetVersion(code) {
  return db.query(
    `SELECT s.code, s.name, s.type_tag, s.updated_at,
            COUNT(p.id)::int AS count,
            COALESCE(MAX(p.id), 0)::bigint AS max_id,
            COALESCE(MAX(p.updated_at), s.updated_at) AS last_change
     FROM sets s
     LEFT JOIN puzzles p ON p.set_code = s.code
     WHERE s.code = $1
     GROUP BY s.code, s.name, s.type_tag, s.updated_at`,
    [code]
  );
}

function versionToEtag(row) {
  const sig = [
    row.code, row.name, row.type_tag,
    String(row.updated_at), row.count, row.max_id, String(row.last_change),
  ].join('|');
  return `"${crypto.createHash('sha1').update(sig).digest('hex').slice(0, 16)}"`;
}

/* Set metadata for the navigation bar: set_code, set_name, puzzle_count per set. */
exports.listSets = async (_req, res) => {
  try {
    const sets = await loadSets();
    res.json({
      total: sets.length,
      totalPuzzles: sets.reduce((sum, s) => sum + s.count, 0),
      sets: sets.map(({ set_code, set_name, type, level, count, folder_id }) => ({
        set_code,
        set_name,
        type,
        level,
        puzzle_count: count,
        folder_id,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle sets', error: err.message });
  }
};

/* Scoped + paginated puzzles for one set — never all sets at once.
   Optional `search` filters within the set with a case-insensitive prefix match
   on the puzzle title/name (+ set code, type, level, difficulty, lichess id).

   Performance contract (see loadSetVersion above):
     · 304 revalidation        → one index query, NO puzzle payload, NO replay.
       Expected ~0–2ms for this handler (the ETag embeds count/max_id/max(updated_at)
       so mounted installs stay correct after inserts, deletes, content edits,
       publish toggles and set renames).
     · 200 (no search)         → page ids via the (set_code,id) index, then full
       rows only for that one page; chess.js replay only for that page.
     · 200 (search on page)    → id/seq/title computed in SQL with the same
       prefix semantics that used to run in JS after loading the whole set.
   The puzzle_count used to be computed by scanning all sets (loadSets); this
   route now gets it from the same preflight query. */
exports.listSetPuzzles = async (req, res) => {
  const t0 = Date.now();
  try {
    // 1) Cheap preflight: set row + change signal, NOT the puzzle payload.
    const pre = await loadSetVersion(req.params.setCode);
    const setRow = pre.rows[0];
    if (!setRow) return res.status(404).json({ message: 'Puzzle set not found' });

    const pageSize = PAGE_SIZES.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : DEFAULT_PAGE_SIZE;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = String(req.query.search || '').trim();

    const set = {
      set_code: setRow.code,
      set_name: setRow.name,
      type: labelForTag(setRow.type_tag),
      typeTag: setRow.type_tag,
      level: null,
      count: setRow.count,
    };

    // 2) "Has anything changed?" — purely from the cheap preflight, before the
    //    expensive part (rows + chess.js replay) has even started.
    const etag = versionToEtag(setRow);
    const lastModified = new Date(setRow.last_change).toUTCString();
    const imsMs = Date.parse(req.get('If-Modified-Since') || '');
    const notModified =
      req.get('If-None-Match') === etag ||
      (Number.isFinite(imsMs) && imsMs >= Math.floor(new Date(setRow.last_change).getTime() / 1000) * 1000);
    if (notModified) {
      res.set('ETag', etag);
      res.set('Last-Modified', lastModified);
      res.status(304).end();
      return;
    }

    // 3) Server-side pagination — page ids (with in-set seq) come straight
    //    from the index; the full payload + replay only cover this page.
    const offset = (page - 1) * pageSize;
    let total = setRow.count;
    let pageSeq;
    if (search) {
      const needle = search.toLowerCase();
      const base = `FROM (
        SELECT p.id,
               (ROW_NUMBER() OVER (ORDER BY COALESCE(p.order_index, 0) ASC NULLS LAST, p.id))::int AS seq,
               p.title,
               (ROW_NUMBER() OVER (ORDER BY COALESCE(p.order_index, 0) ASC NULLS LAST, p.id))::int AS row_num,
               (s.name || ' - ' || (ROW_NUMBER() OVER (ORDER BY p.id))) AS fallback_title,
               s.code AS set_code
        FROM puzzles p JOIN sets s ON s.code = p.set_code
        WHERE p.set_code = $1
      ) m`;
      const where = `WHERE LOWER(COALESCE(m.title, m.fallback_title)) LIKE LOWER($2) || '%' OR LOWER(m.set_code) LIKE LOWER($2) || '%'`;
      const cRes = await db.query(`SELECT COUNT(*)::int AS c ${base} ${where}`, [setRow.code, needle]);
      total = cRes.rows[0].c;
      const pRes = await db.query(
        `SELECT m.id, m.seq ${base} ${where} ORDER BY m.seq ASC LIMIT $3 OFFSET $4`,
        [setRow.code, needle, pageSize, offset]
      );
      pageSeq = pRes.rows;
    } else {
      const pRes = await db.query(
        `SELECT id, (ROW_NUMBER() OVER (ORDER BY COALESCE(order_index, 0) ASC NULLS LAST, id))::int AS seq
         FROM puzzles WHERE set_code = $1
         ORDER BY COALESCE(order_index, 0) ASC NULLS LAST, id ASC LIMIT $2 OFFSET $3`,
        [setRow.code, pageSize, offset]
      );
      pageSeq = pRes.rows;
    }

    const puzzles = [];
    if (pageSeq.length > 0) {
      const rowRes = await db.query(
        `SELECT id, fen, solution, theme, themes, difficulty, lichess_id, nb_plays, explanation, is_published, title, order_index, rating
         FROM puzzles WHERE id = ANY($1)`,
        [pageSeq.map((r) => r.id)]
      );
      const byId = new Map(rowRes.rows.map((r) => [r.id, r]));
      for (const m of pageSeq) {
        const p = byId.get(m.id);
        if (p) puzzles.push(cardFromRow(p, set, m.seq));
      }
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.set('ETag', etag);
    res.set('Last-Modified', lastModified);
    res.set('Cache-Control', 'private, no-cache'); // revalidate via the cheap ETag path
    res.json({
      set: { set_code: set.set_code, set_name: set.set_name, type: set.type, level: set.level, puzzle_count: set.count },
      search,
      page,
      pageSize,
      total,
      totalPages,
      puzzles,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load set puzzles', error: err.message });
  } finally {
    const ms = Date.now() - t0;
    if (ms > 150) {
      console.warn(`[slow] GET /api/puzzles/sets/${req.params.setCode}?${req.url.split('?')[1] || ''} → ${ms}ms`);
    }
  }
};

/* Cross-set ("All") search with server-side pagination — searches every set in
   one SQL pass so we never load the whole dataset into memory. Matching is a
   case-insensitive PREFIX on the set name, set code or generated title
   ("Endgame - 12"), mirroring the within-set behaviour. UCI replay happens
   only for the requested page so large datasets stay cheap. */
exports.searchPuzzles = async (req, res) => {
  try {
    const sets = await loadSets();
    const q = String(req.query.q || '').trim();
    const pageSize = PAGE_SIZES.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : DEFAULT_PAGE_SIZE;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const whereParts = [];
    const params = [];
    const needle = q.toLowerCase();
    if (needle) {
      params.push(needle);
      whereParts.push(`(
        LOWER(m.set_name) LIKE LOWER($1) || '%'
        OR LOWER(m.set_code) LIKE LOWER($1) || '%'
        OR LOWER(m.title) LIKE LOWER($1) || '%'
      )`);
    }
    const whereClause = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT p.id, p.set_code, s.name AS set_name,
                (s.name || ' - ' || (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))) AS title
         FROM puzzles p
         JOIN sets s ON s.code = p.set_code
       ) m ${whereClause}`,
      params
    );
    const total = totalRes.rows[0].c;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    params.push(pageSize);
    const pageSizeIdx = params.length;
    params.push(start);
    const pageRes = await db.query(
      `SELECT m.id, m.set_code, m.set_name, m.type_tag, m.seq
       FROM (
         SELECT p.id, p.set_code, s.name AS set_name, s.type_tag,
                (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq,
                (s.name || ' - ' || (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))) AS title
         FROM puzzles p
         JOIN sets s ON s.code = p.set_code
       ) m ${whereClause}
       ORDER BY m.set_name ASC, m.set_code ASC, m.seq ASC
       LIMIT $${pageSizeIdx} OFFSET $${params.length}`,
      params
    );

    const cards = [];
    const pageMeta = pageRes.rows;
    if (pageMeta.length > 0) {
      const rowRes = await db.query(
        `SELECT id, fen, solution, theme, themes, difficulty, lichess_id, nb_plays, explanation, is_published
         FROM puzzles WHERE id = ANY($1)`,
        [pageMeta.map((m) => m.id)]
      );
      const byId = new Map(rowRes.rows.map((r) => [r.id, r]));
      for (const m of pageMeta) {
        const p = byId.get(m.id);
        if (!p) continue;
        cards.push(
          cardFromRow(
            p,
            {
              set_code: m.set_code,
              set_name: m.set_name,
              type: labelForTag(m.type_tag),
              typeTag: m.type_tag,
              level: null,
            },
            m.seq
          )
        );
      }
    }

    res.json({
      q,
      page,
      pageSize,
      total,
      totalPages,
      sets: sets.map(({ set_code, set_name, type, level, count, folder_id }) => ({
        set_code,
        set_name,
        type,
        level,
        puzzle_count: count,
        folder_id,
      })),
      puzzles: cards,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to search puzzles', error: err.message });
  }
};

/* ──────────────── mirror a library assign into the assignment system ────────────────
   The puzzle library assigns via `student_puzzle_assignments` (per student ×
   puzzle, with due date/notes/points). The coach "Puzzle Assignments" screen
   reads `assignments` + `assignment_puzzles` + `assignment_submissions`.

   To make a library assign show up there, we also create ONE `assignments` row
   for the whole batch, link its puzzles in order, and give every targeted
   student a submission row. The original `student_puzzle_assignments` rows are
   left untouched — the students' "My Assigned Puzzles" view still reads them.
   ───────────────────────────────────────────────────────────────────────────── */
async function mirrorLibraryAssign({ title, setCode, puzzleIds, studentIds, dueDate, maxAttempts, createdBy }) {
  if (!puzzleIds.length || !studentIds.length) return null;

  const sets = setCode
    ? [{ code: setCode }]
    : (await db.query('SELECT DISTINCT set_code AS code FROM puzzles WHERE id = ANY($1)', [puzzleIds])).rows
        .map((r) => r.code).filter(Boolean);
  const onlySet = setCode || (sets.length === 1 ? sets[0] : null);

  const created = await db.query(
    `INSERT INTO assignments
       (title, type, status, max_attempts, due_date, puzzle_set_code, created_by)
     VALUES ($1, 'puzzle_assignment', 'active', $2, $3, $4, $5)
     RETURNING id`,
    [title, Math.max(1, Number(maxAttempts) || 1), dueDate || null, onlySet, createdBy || null]
  );
  const assignmentId = created.rows[0].id;

  await db.query(
    `INSERT INTO assignment_puzzles (assignment_id, puzzle_id, order_index)
     SELECT $1, t.puzzle_id, (t.ord - 1)::int
     FROM unnest($2::int[]) WITH ORDINALITY AS t(puzzle_id, ord)
     ON CONFLICT (assignment_id, puzzle_id) DO NOTHING`,
    [assignmentId, puzzleIds]
  );

  await db.query(
    `INSERT INTO assignment_submissions (assignment_id, student_id, status, progress_completed)
     SELECT $1, s, 'pending', 0 FROM unnest($2::int[]) AS s
     ON CONFLICT (assignment_id, student_id) DO NOTHING`,
    [assignmentId, studentIds]
  );

  return assignmentId;
}

/* Human-friendly batch title, e.g. "MATE INJ 4 (A) — 23 Sep". */
async function libraryAssignTitle(puzzleIds, setCode) {
  let label = setCode;
  if (!label) {
    const r = await db.query(
      `SELECT s.name FROM puzzles p JOIN sets s ON s.code = p.set_code
       WHERE p.id = $1 LIMIT 1`,
      [puzzleIds[0]]
    );
    label = r.rows[0]?.name;
  }
  const d = new Date();
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return label ? `${label} — ${day}` : `Puzzles — ${day}`;
}

/* ──────────────── assign puzzles to students (due date/notes/status) ────────────────
   Creates records in `student_puzzle_assignments`. Duplicate (student, puzzle)
   pairs are skipped silently and reported so the UI can warn instead of
   duplicating. */
exports.assignPuzzlesToStudents = async (req, res) => {
  try {
    /* ── New payload: an explicit array of per-student, per-puzzle records. ── */
    const recordsRaw = Array.isArray(req.body.records) ? req.body.records : [];
    if (recordsRaw.length > 0) {
      const records = [];
      for (const r of recordsRaw) {
        const studentId = parseInt(r.studentId, 10);
        const puzzleId = parseInt(r.puzzleId, 10);
        if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(puzzleId) || puzzleId <= 0) continue;

        const time = r.time === '' || r.time == null ? null : parseInt(r.time, 10);
        const points = Number.isNaN(parseInt(r.points, 10)) ? 10 : parseInt(r.points, 10);
        const attempts = Math.max(1, Number.isNaN(parseInt(r.attempts, 10)) ? 3 : parseInt(r.attempts, 10));
        const negativePoints = Math.max(0, Number.isNaN(parseInt(r.negativePoints, 10)) ? 0 : parseInt(r.negativePoints, 10));

        records.push({
          studentId,
          puzzleId,
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(r.dueDate || '')) ? r.dueDate : null,
          notes: String(r.notes || '').trim() || null,
          timeLimitSeconds: Number.isInteger(time) && time >= 0 ? time : null,
          points,
          attempts,
          negativePoints,
        });
      }

      if (records.length === 0) {
        return res.status(400).json({ message: 'No valid assignment records' });
      }

      const idSets = {
        students: [...new Set(records.map((r) => r.studentId))],
        puzzles: [...new Set(records.map((r) => r.puzzleId))],
      };

      // Restrict to rows that actually exist (graceful handling of stale ids).
      const pRes = await db.query('SELECT id FROM puzzles WHERE id = ANY($1)', [idSets.puzzles]);
      const validPuzzles = pRes.rows.map((r) => r.id);
      const sRes = await db.query('SELECT id FROM students WHERE id = ANY($1)', [idSets.students]);
      const validStudents = sRes.rows.map((r) => r.id);
      if (validPuzzles.length === 0 || validStudents.length === 0) {
        return res.status(400).json({ message: 'No valid puzzles/students to assign' });
      }

      const validPuzzleSet = new Set(validPuzzles);
      const validStudentSet = new Set(validStudents);
      const filtered = records.filter((r) => validPuzzleSet.has(r.puzzleId) && validStudentSet.has(r.studentId));
      if (filtered.length === 0) {
        return res.status(400).json({ message: 'No valid puzzles/students to assign' });
      }

      // Count records that already exist so the response can report skipped ones;
      // existing rows get their config refreshed (due date, notes + settings).
      const existingRes = await db.query(
        `SELECT student_id, puzzle_id FROM student_puzzle_assignments
         WHERE student_id = ANY($1) AND puzzle_id = ANY($2)`,
        [validStudents, validPuzzles]
      );
      const existing = new Set(existingRes.rows.map((r) => `${r.student_id}:${r.puzzle_id}`));

      let updated = 0;
      for (const rec of filtered) {
        const ins = await db.query(
          `INSERT INTO student_puzzle_assignments
             (student_id, puzzle_id, assigned_date, due_date, status, notes, assigned_by,
              time_limit_seconds, points, max_attempts, negative_points)
           VALUES ($1,$2,CURRENT_DATE,$3,'assigned',$4,$5,$6,$7,$8,$9)
           ON CONFLICT (student_id, puzzle_id) DO UPDATE SET
             due_date = EXCLUDED.due_date,
             notes = EXCLUDED.notes,
             time_limit_seconds = EXCLUDED.time_limit_seconds,
             points = EXCLUDED.points,
             max_attempts = EXCLUDED.max_attempts,
             negative_points = EXCLUDED.negative_points`,
          [rec.studentId, rec.puzzleId, rec.dueDate, rec.notes, req.user.id,
           rec.timeLimitSeconds, rec.points, rec.attempts, rec.negativePoints]
        );
        updated += ins.rowCount || 0;
      }

      // Auto-publish the assigned puzzles so they immediately show up in the
      // students' assigned-puzzle view (which filters to published + assigned).
      if (validPuzzles.length > 0) {
        await db.query('UPDATE puzzles SET is_published = true WHERE id = ANY($1)', [validPuzzles]);
      }

      // Mirror the batch into the assignment system so it shows up in the
      // coach's "Puzzle Assignments" screen (original rows stay intact).
      const maxAttemptsFromBatch = Math.max(1, ...filtered.map((r) => r.attempts || 1));
      const assignmentId = await mirrorLibraryAssign({
        title: await libraryAssignTitle(validPuzzles, null),
        setCode: null,
        puzzleIds: validPuzzles,
        studentIds: validStudents,
        dueDate: filtered.find((r) => r.dueDate)?.dueDate || null,
        maxAttempts: maxAttemptsFromBatch,
        createdBy: req.user.id,
      });

      const existedCount = filtered.filter((r) => existing.has(`${r.studentId}:${r.puzzleId}`)).length;
      return res.json({
        message: `Assigned ${filtered.length - existedCount} record${filtered.length - existedCount === 1 ? '' : 's'}${existedCount > 0 ? ` — ${existedCount} already assigned (settings refreshed)` : ''}`,
        assigned: filtered.length - existedCount,
        updated,
        skipped: existedCount,
        due_date: null,
        puzzle_count: validPuzzles.length,
        student_count: validStudents.length,
        assignment_id: assignmentId,
      });
    }

    /* ── Legacy payload: { puzzle_ids, student_ids, due_date, notes } ── */
    let puzzleIds = Array.isArray(req.body.puzzle_ids)
      ? [...new Set(req.body.puzzle_ids)].filter((n) => Number.isInteger(n) && n > 0)
      : [];
    let studentIds = Array.isArray(req.body.student_ids)
      ? [...new Set(req.body.student_ids)].filter((n) => Number.isInteger(n) && n > 0)
      : [];

    if (puzzleIds.length === 0 || studentIds.length === 0) {
      return res.status(400).json({ message: 'puzzle_ids and student_ids are required' });
    }

    const dueRaw = String(req.body.due_date || '').trim();
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
    const notes = String(req.body.notes || '').trim() || null;

    // Restrict to rows that actually exist (graceful handling of stale ids).
    const pRes = await db.query('SELECT id FROM puzzles WHERE id = ANY($1)', [puzzleIds]);
    const validPuzzles = pRes.rows.map((r) => r.id);
    const sRes = await db.query('SELECT id FROM students WHERE id = ANY($1)', [studentIds]);
    const validStudents = sRes.rows.map((r) => r.id);
    if (validPuzzles.length === 0 || validStudents.length === 0) {
      return res.status(400).json({ message: 'No valid puzzles/students to assign' });
    }

    const pairs = validPuzzles.length * validStudents.length;
    const result = await db.query(
      `INSERT INTO student_puzzle_assignments (student_id, puzzle_id, assigned_date, due_date, status, notes, assigned_by)
       SELECT s, p, CURRENT_DATE, $2, 'assigned', $3, $4
       FROM unnest($1::int[]) AS s, unnest($5::int[]) AS p
       ON CONFLICT (student_id, puzzle_id) DO NOTHING
       RETURNING id`,
      [validStudents, dueDate, notes, req.user.id, validPuzzles]
    );

    const assigned = result.rowCount || 0;
    const skipped = pairs - assigned;

    // Auto-publish the assigned puzzles so they immediately show up in the
    // students' assigned-puzzle view (which filters to published + assigned).
    if (validPuzzles.length > 0) {
      await db.query('UPDATE puzzles SET is_published = true WHERE id = ANY($1)', [validPuzzles]);
    }

    // Mirror into the assignment system (see mirrorLibraryAssign).
    const assignmentId = await mirrorLibraryAssign({
      title: await libraryAssignTitle(validPuzzles, null),
      setCode: null,
      puzzleIds: validPuzzles,
      studentIds: validStudents,
      dueDate,
      maxAttempts: 1,
      createdBy: req.user.id,
    });

    res.json({
      message: `Assigned ${assigned} record${assigned === 1 ? '' : 's'}${skipped > 0 ? ` — ${skipped} already assigned` : ''}`,
      assigned,
      skipped,
      due_date: dueDate,
      puzzle_count: validPuzzles.length,
      student_count: validStudents.length,
      assignment_id: assignmentId,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(200).json({ message: 'All selected puzzles are already assigned to those students', assigned: 0, skipped: 1 });
    }
    res.status(500).json({ message: 'Failed to assign puzzles', error: err.message });
  }
};

/* Lightweight title lookup for the "Assign to Students" modal's per-puzzle rows. */
exports.getPuzzleTitles = async (req, res) => {
  try {
    let ids = String(req.query.ids || '')
      .split(',')
      .map((n) => parseInt(n, 10));
    ids = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return res.json({ puzzles: [] });

    const result = await db.query(
      `SELECT p.id, p.set_code, s.name AS set_name,
              (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq
       FROM puzzles p
       LEFT JOIN sets s ON s.code = p.set_code
       WHERE p.id = ANY($1)
       ORDER BY p.id`,
      [ids]
    );

    const puzzles = result.rows.map((r) => ({
      id: r.id,
      set_code: r.set_code,
      set_name: r.set_name,
      seq: r.seq,
      title: r.set_name ? `${r.set_name} - ${r.seq}` : `Puzzle #${r.id}`,
    }));

    res.json({ puzzles });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle titles', error: err.message });
  }
};

/* Dataset-wide listing — PAGINATED + LIGHTWEIGHT. Returns every puzzle across
   all sets, but only the fields a listing view needs (no FEN/solution/themes,
   no per-move chess.js replay). `seq` is the puzzle's stable position within
   its set (same numbering as /sets/:code and /search), so a puzzle keeps the
   same title everywhere. page/pageSize are optional and follow the same
   pattern as the other puzzle endpoints. Full replayable cards (fen, uci,
   san, explanation) live in /sets/:setCode and /search. */
exports.listingPuzzles = async (req, res) => {
  try {
    const sets = await loadSets();
    const pageSize = PAGE_SIZES.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : DEFAULT_PAGE_SIZE;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const totalRes = await db.query(
      'SELECT COUNT(*)::int AS c FROM puzzles p JOIN sets s ON s.code = p.set_code'
    );
    const total = totalRes.rows[0].c;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    const result = await db.query(
      `SELECT p.id, p.set_code, p.difficulty, p.lichess_id, p.nb_plays, p.is_published,
              s.name AS set_name, s.type_tag,
              (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq
       FROM puzzles p
       JOIN sets s ON s.code = p.set_code
       ORDER BY s.name ASC, p.set_code ASC, seq ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, start]
    );

    const puzzles = result.rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      title: `${r.set_name} - ${r.seq}`,
      set_code: r.set_code,
      set_name: r.set_name,
      type: labelForTag(r.type_tag),
      typeTag: r.type_tag,
      level: null,
      difficulty: r.difficulty,
      lichess_id: r.lichess_id,
      nb_plays: r.nb_plays,
      is_published: r.is_published,
    }));

    res.json({
      total,
      page,
      pageSize,
      totalPages,
      sets: sets.map(({ set_code, set_name, type, level, count, folder_id }) => ({
        set_code,
        set_name,
        type,
        level,
        puzzle_count: count,
        folder_id,
      })),
      puzzles,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle listing', error: err.message });
  }
};

/* ──────────────── theme categories & counts ──────────────── */

exports.themeCategories = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT unnest(themes) AS theme, COUNT(*) AS count
      FROM puzzles
      WHERE array_length(themes, 1) > 0
      GROUP BY 1
      ORDER BY count DESC
    `);
    const themeCounts = {};
    for (const r of result.rows) themeCounts[r.theme] = Number(r.count);

    // also count by primary theme (for non-lichess puzzles)
    const primaryRes = await db.query(`
      SELECT theme, COUNT(*) AS count
      FROM puzzles
      WHERE theme IS NOT NULL AND array_length(themes, 1) IS NULL
      GROUP BY theme ORDER BY count DESC
    `);
    for (const r of primaryRes.rows) {
      themeCounts[r.theme] = (themeCounts[r.theme] || 0) + Number(r.count);
    }

    const categories = {};
    for (const [key, cat] of Object.entries(LICHESS_CATEGORIES)) {
      const items = cat.themes
        .filter((t) => themeCounts[t])
        .map((t) => ({
          id: t,
          label: DIFFICULTY_MAP[t] || t,
          count: themeCounts[t] || 0,
        }));
      if (items.length > 0) {
        categories[key] = { label: cat.label, icon: cat.icon, items };
      }
    }

    res.json({ categories, totalThemes: Object.keys(themeCounts).length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load theme categories', error: err.message });
  }
};

/* ──────────────── get single puzzle ──────────────── */

exports.getPuzzle = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, fen, theme, themes, difficulty, explanation, game_url, nb_plays, popularity FROM puzzles WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch puzzle', error: err.message });
  }
};

/* ──────────────── create single puzzle ──────────────── */

exports.createPuzzle = async (req, res) => {
  try {
    const { fen, solution, theme, themes, difficulty, explanation } = req.body;
    if (!fen || !solution) return res.status(400).json({ message: 'FEN and solution are required' });
    const uciSolution = toUCI(fen, solution);
    const isPublished = req.body.is_published !== false;

    const type = puzzleTypeFromTheme(theme || (themes && themes[0]) || '');
    const setCode = codeForTag(type.tag);
    await db.query(
      'INSERT INTO sets (code, name, type_tag) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [setCode, type.label, type.tag]
    );

    const result = await db.query(
      `INSERT INTO puzzles (fen, solution, theme, themes, difficulty, explanation, is_published, set_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [fen, JSON.stringify(uciSolution), theme, themes || [theme] || ['tactics'], difficulty || 'Medium', explanation, isPublished, setCode]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Failed to create puzzle: ' + err.message });
  }
};

/* ──────────────── delete puzzle ──────────────── */

exports.deletePuzzle = async (req, res) => {
  try {
    await db.query('DELETE FROM puzzles WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete puzzle', error: err.message });
  }
};

/* ──────────────── toggle publish (admin visibility control) ──────────────── */

exports.togglePublish = async (req, res) => {
  try {
    const { is_published } = req.body;
    if (typeof is_published !== 'boolean') {
      return res.status(400).json({ message: 'is_published must be a boolean' });
    }
    const result = await db.query(
      'UPDATE puzzles SET is_published = $1 WHERE id = $2 RETURNING id, is_published',
      [is_published, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update puzzle', error: err.message });
  }
};

/* ──────── bulk import — accept JSON array of puzzles ──────── */

exports.bulkImport = async (req, res) => {
  try {
    const { puzzles } = req.body; // array of { lichess_id, fen, solution, theme, themes, difficulty, nb_plays, popularity, game_url, opening_tags }
    if (!Array.isArray(puzzles) || puzzles.length === 0) {
      return res.status(400).json({ message: 'Provide a non-empty puzzles array' });
    }

    const BATCH = 500;
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < puzzles.length; i += BATCH) {
      const chunk = puzzles.slice(i, i + BATCH);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const p of chunk) {
        if (!p.fen || !p.solution) { skipped++; continue; }
        const row = [
          p.lichess_id || null,
          p.fen,
          JSON.stringify(p.solution),
          p.theme || 'Tactics',
          p.themes || [],
          p.difficulty || 'Medium',
          p.explanation || null,
          p.nb_plays || 0,
          p.popularity || 0,
          p.game_url || null,
          p.opening_tags || [],
        ];
        placeholders.push(`(${row.map(() => `$${idx++}`).join(',')})`);
        values.push(...row);
      }

      if (placeholders.length === 0) continue;

      const sql = `
        INSERT INTO puzzles (lichess_id, fen, solution, theme, themes, difficulty, explanation, nb_plays, popularity, game_url, opening_tags)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (lichess_id) DO UPDATE SET
          nb_plays = EXCLUDED.nb_plays, popularity = EXCLUDED.popularity
      `;
      try {
        const r = await pool.query(sql, values);
        imported += r.rowCount;
      } catch (err) {
        console.error('Bulk import batch error:', err.message);
        skipped += placeholders.length;
      }
    }

    await syncPuzzleSets();
    res.json({ imported, skipped, total: puzzles.length });
  } catch (err) {
    res.status(500).json({ message: 'Bulk import failed', error: err.message });
  }
};

/* ──────── CSV import via API ──────── */

const THEME_LABELS_REVERSE = {
  fork: 'fork', pin: 'pin', skewer: 'skewer', sacrifice: 'sacrifice',
  discoveredAttack: 'discoveredAttack', doubleCheck: 'doubleCheck',
  trappedPiece: 'trappedPiece', deflection: 'deflection',
  attraction: 'attraction', intermezzo: 'intermezzo',
  xrayAttack: 'xrayAttack', zugzwang: 'zugzwang',
  hangingPiece: 'hangingPiece', capturedDefender: 'capturedDefender',
  backRankMate: 'backRankMate', mateIn1: 'mateIn1', mateIn2: 'mateIn2',
  mateIn3: 'mateIn3', mateIn4: 'mateIn4', mateIn5: 'mateIn5',
  smotheredMate: 'smotheredMate', operaMate: 'operaMate',
  hookMate: 'hookMate', dovetailMate: 'dovetailMate',
  rookEndgame: 'rookEndgame', bishopEndgame: 'bishopEndgame',
  pawnEndgame: 'pawnEndgame', knightEndgame: 'knightEndgame',
  queenEndgame: 'queenEndgame',
  opening: 'opening', middlegame: 'middlegame', endgame: 'endgame',
  advantage: 'advantage', crushing: 'crushing', equality: 'equality',
  oneMove: 'oneMove', shortPuzzle: 'shortPuzzle', longPuzzle: 'longPuzzle', veryLong: 'veryLong',
};

const THEME_LABELS_FORWARD = {
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered Attack', doubleCheck: 'Double Check',
  trappedPiece: 'Trapped Piece', deflection: 'Deflection',
  attraction: 'Attraction', intermezzo: 'Intermezzo',
  xrayAttack: 'X-Ray Attack', zugzwang: 'Zugzwang',
  hangingPiece: 'Hanging Piece', capturedDefender: 'Capture Defender',
  backRankMate: 'Back-Rank Mate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5+',
  smotheredMate: 'Smothered Mate', operaMate: 'Opera Mate',
  hookMate: 'Hook Mate', dovetailMate: 'Dovetail Mate',
  rookEndgame: 'Rook Endgame', bishopEndgame: 'Bishop Endgame',
  pawnEndgame: 'Pawn Endgame', knightEndgame: 'Knight Endgame',
  queenEndgame: 'Queen Endgame',
  opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame',
  advantage: 'Advantage', crushing: 'Crushing', equality: 'Equality',
  oneMove: 'One-Move', short: 'Short', long: 'Long', veryLong: 'Very Long',
};

/**
 * CSV import — STRICTLY append/update. Never deletes or truncates existing
 * puzzles (a `clearFirst` request is rejected outright). Behavior per row:
 *   • brand-new puzzle        → inserted with a fresh auto-increment id
 *   • same lichess_id but     → refreshes only that one puzzle (id preserved,
 *     different data            so attempts/assignments stay valid)
 *   • same FEN + solution     → skipped and reported as a duplicate
 * The whole batch runs in a single transaction and is written to the
 * `puzzle_imports` audit table for traceability.
 */
exports.importCSV = async (req, res) => {
  const { csv, limit = 5000, file_name = 'puzzle-import.csv' } = req.body;
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ message: 'Provide a csv string' });
  }
  // Data-safety safeguard: imports are additive only. Never honor a wipe flag.
  if (req.body.clearFirst === true || req.body.clearFirst === 'true') {
    return res.status(400).json({ message: 'Destructive import flag (clearFirst) is not supported — imports append/update only' });
  }

  const rawLines = String(csv).split('\n').map((l) => l.replace(/\r$/, '').trim()).filter(Boolean);
  const colMap = detectColumns(rawLines[0] || '');
  // Header-aware: when a recognizable header row exists, drop it and read
  // columns by name. Otherwise fall back to the classic lichess positional rows.
  const rows = colMap.structured ? rawLines.slice(1) : rawLines.filter((l) => !/^PuzzleId/i.test(l));

  // ── Pass 1: parse + validate each row (bad rows never block good ones) ──
  const errors = [];
  const candidates = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 1-indexed, header = row 1
    if (candidates.length >= limit) {
      errors.push({ row: rowNumber, reason: 'Row exceeds the import limit — skipped' });
      continue;
    }
    const row = parseCsvRow(rows[i], colMap);
    if (row.error) {
      errors.push({ row: rowNumber, reason: row.error });
      continue;
    }
    candidates.push(row);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Pass 2: classify against existing rows with two batched lookups ──
    const fens = [...new Set(candidates.map((c) => c.fen))];
    const lics = [...new Set(candidates.map((c) => c.lichess_id).filter(Boolean))];

    const existingByFen = new Map();
    if (fens.length) {
      const r = await client.query('SELECT id, fen, solution, lichess_id FROM puzzles WHERE fen = ANY($1)', [fens]);
      for (const p of r.rows) {
        if (!existingByFen.has(p.fen)) existingByFen.set(p.fen, []);
        existingByFen.get(p.fen).push({ id: p.id, lichess_id: p.lichess_id, solKey: solutionKey(p.fen, p.solution) });
      }
    }

    const existingByLic = new Map();
    if (lics.length) {
      const r = await client.query('SELECT id, fen, solution, lichess_id FROM puzzles WHERE lichess_id = ANY($1)', [lics]);
      for (const p of r.rows) existingByLic.set(p.lichess_id, { ...p, solKey: solutionKey(p.fen, p.solution) });
    }

    const rowsToWrite = [];
    const seenInFileFen = new Set(); // (`fen|solution`) seen earlier in this file
    const seenInFileLic = new Set(); // lichess_id claimed by an earlier row in this file
    let duplicates = 0;
    let updated = 0;

    for (const c of candidates) {
      const dupKey = `${c.fen}|${c.solKey}`;

      if (seenInFileFen.has(dupKey)) { duplicates++; continue; } // exact duplicate within the same file
      seenInFileFen.add(dupKey);

      const sameFen = existingByFen.get(c.fen) || [];
      if (sameFen.some((r) => r.solKey === c.solKey)) { duplicates++; continue; } // exact duplicate vs database

      if (c.lichess_id) {
        if (seenInFileLic.has(c.lichess_id)) { duplicates++; continue; } // two rows → one id: keep the first
        const existing = existingByLic.get(c.lichess_id);
        if (existing) {
          seenInFileLic.add(c.lichess_id);
          if (existing.fen === c.fen && existing.solKey === c.solKey) { duplicates++; continue; } // same id + same data
          c.__update = true; // same id + different data → refresh ONLY that puzzle
          updated++;
        } else {
          seenInFileLic.add(c.lichess_id);
        }
      }

      rowsToWrite.push(c);
    }

    // ── Pass 3: chunked upsert inside the same transaction ──
    const written = await writePuzzleRows(client, rowsToWrite);
    const imported = Math.max(0, written - updated);

    // Assign set_code to freshly inserted rows (inside the same transaction).
    await syncPuzzleSets(client);

    // ── Audit trail ──
    await client.query(
      `INSERT INTO puzzle_imports (admin_user_id, file_name, total_rows, imported, updated, duplicates, errors, errors_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user?.id ?? null, file_name, rows.length, imported, updated, duplicates, errors.length, JSON.stringify(errors)]
    );

    await client.query('COMMIT');
    const summary = `${imported} puzzles imported, ${updated} updated, ${duplicates} duplicates skipped, ${errors.length} errors`;
    res.json({
      message: summary,
      imported,
      updated,
      duplicates,
      total_rows: rows.length,
      errors: errors.length,
      errors_detail: errors.slice(0, 50),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'CSV import failed — no rows were changed (transaction rolled back)', error: err.message });
  } finally {
    client.release();
  }
};

/* Detect the CSV layout from its header row (if any).
   Returns a column-index map plus:
     structured = a header with FEN + a move column was found
     direct     = the move column is named like "Solution …" → fen is ALREADY the
                  puzzle position and the cell holds the solution (no trigger shift).
   When no usable header exists it returns a positional fallback map that keeps
   the classic lichess column order working. */
function detectColumns(firstLine) {
  const parts = firstLine.split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (parts.length < 3 || parts.some((p) => !p)) return { structured: false };
  const idx = (re) => parts.findIndex((h) => re.test(h));
  const map = {
    id: idx(/puzzleid|sourceid|^id$/),
    fen: idx(/^fen$/),
    moves: idx(/^moves$/),
    solution: idx(/solut/),
    popularity: idx(/popularity/),
    plays: idx(/nbplays/),
    themes: idx(/^themes?$/),
    gameUrl: idx(/gameurl/),
    openingTags: idx(/openingtags|tags/),
    difficulty: idx(/difficulty/),
    structured: false,
    direct: false,
  };
  if (map.fen < 0) return { structured: false };
  const moveCol = map.solution >= 0 ? map.solution : map.moves;
  if (moveCol < 0) return { structured: false };
  map.moves = moveCol;
  map.direct = map.solution >= 0;
  map.structured = true;
  return map;
}

/* Map a free-form difficulty cell to the four canonical levels, never throwing. */
function normalizeDifficulty(raw) {
  const v = String(raw || '').trim();
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return ['Easy', 'Medium', 'Hard', 'Expert'].includes(cap) ? cap : 'Medium';
}

/* Replay a move list from a position and return the canonical UCI array. */
function uciMovesFrom(fen, moveList) {
  const g = new Chess(fen);
  const out = [];
  for (const m of moveList) {
    let applied;
    try {
      applied = UCI_RE.test(m)
        ? g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined })
        : g.move(m);
    } catch { /* illegal → handled below */ }
    if (!applied) throw new Error(`"${m}"`);
    out.push(applied.from + applied.to + (applied.promotion || ''));
  }
  return out;
}

/* Parse + validate one CSV line → { fen, solKey, uciSolution, …values } or { error }.
   Stored FEN is the position after the trigger move (lichess-style) or the FEN
   as given ("Solution …" layout); the solution is always normalized to UCI so
   dedupe + replay are consistent. A rating column (if any) is ignored entirely —
   it is neither validated, parsed, nor stored. */
function parseCsvRow(line, map = { structured: false }) {
  const parts = line.split(',');
  const at = (i) => (i != null && i >= 0 ? parts[i] : undefined);
  const n = (i) => (i != null && i >= 0 ? Number(parts[i] || 0) || 0 : 0);

  // Resolve indices: structured → header map; positional → classic lichess order.
  const iId = map.structured ? map.id : 0;
  const iFen = map.structured ? map.fen : 1;
  const iMoves = map.structured ? map.moves : 2;
  const iPop = map.structured ? map.popularity : 5;
  const iPlays = map.structured ? map.plays : 6;
  const iThemes = map.structured ? map.themes : 7;
  const iGame = map.structured ? map.gameUrl : 8;
  const iOpen = map.structured ? map.openingTags : 9;
  const iDiff = map.structured ? map.difficulty : -1;

  const fenRaw = at(iFen);
  const movesRaw = at(iMoves);

  if (!fenRaw || !movesRaw) {
    return at(iFen) === undefined && at(iMoves) === undefined
      ? { error: 'Row is empty' }
      : { error: 'Missing FEN or Moves column' };
  }

  let chess1;
  try { chess1 = new Chess(fenRaw); } catch { return { error: 'Invalid FEN position' }; }

  const allMoves = String(movesRaw).trim().split(/[\s_,|]+/).filter(Boolean);

  let puzzleFen;
  let uciSolution;
  if (map.direct) {
    // "Solution …" layout: the FEN is already the puzzle position and the cell
    // is the solution the student must play.
    if (allMoves.length < 1) return { error: 'No solution moves found' };
    puzzleFen = chess1.fen();
    try { uciSolution = uciMovesFrom(puzzleFen, allMoves); }
    catch (e) { return { error: `Illegal solution move — ${e.message}` }; }
  } else {
    // Classic lichess layout: the first move is the trigger that produces the
    // puzzle position; the remaining moves are the solution to store.
    if (allMoves.length < 2) return { error: 'Moves must contain a trigger move plus at least one solution move' };
    const trigger = allMoves[0];
    try {
      chess1.move(UCI_RE.test(trigger)
        ? { from: trigger.slice(0, 2), to: trigger.slice(2, 4), promotion: trigger.length > 4 ? trigger[4] : undefined }
        : trigger);
    } catch {
      return { error: `Illegal trigger move "${trigger}"` };
    }
    puzzleFen = chess1.fen();
    try { uciSolution = uciMovesFrom(puzzleFen, allMoves.slice(1)); }
    catch (e) { return { error: `Illegal solution move — ${e.message}` }; }
  }

  const themeTags = at(iThemes) ? at(iThemes).trim().split(/[\s_,|]+/).filter(Boolean).map((t) => t.toLowerCase()) : [];
  const firstTag = themeTags[0] || '';
  const primaryLabel = THEME_LABELS_FORWARD[firstTag] || themeTags[0] || 'Tactics';
  const difficulty = normalizeDifficulty(at(iDiff));
  const openingTagsArr = at(iOpen) ? at(iOpen).trim().split(/[\s_,|]+/).filter(Boolean) : [];

  return {
    fen: puzzleFen,
    solKey: JSON.stringify(uciSolution),
    uciSolution,
    lichess_id: at(iId) || null,
    theme: primaryLabel,
    themes: themeTags,
    difficulty,
    nb_plays: n(iPlays),
    popularity: Math.round(n(iPop)),
    game_url: at(iGame) || null,
    opening_tags: openingTagsArr,
  };
}

/* Canonical duplicate key for an existing row — UCI-ize its stored solution too,
   so SAN/UCI imports dedupe against the same tactic. */
function solutionKey(fen, storedSolution) {
  try { return JSON.stringify(toUCI(fen, storedSolution)); } catch { /* fall back to raw JSON */ }
  return JSON.stringify((Array.isArray(storedSolution) ? storedSolution : []).map(String).map((s) => s.toLowerCase()));
}

/* One multi-row upsert per chunk. Rows without a lichess_id can never conflict →
   they are plain inserts; rows with an existing lichess_id update only that row.
   is_published is preserved for updated rows so admin visibility/assignment
   settings are never stomped by a re-import. */
async function writePuzzleRows(client, rows, batchSize = 500) {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const p of chunk) {
      const row = [
        p.lichess_id, p.fen, JSON.stringify(p.uciSolution), p.theme, p.themes,
        p.difficulty, null, p.nb_plays,
        p.popularity, p.game_url, p.opening_tags,
      ];
      placeholders.push(`(${row.map(() => `$${idx++}`).join(',')})`);
      values.push(...row);
    }

    const sql = `
      INSERT INTO puzzles (lichess_id, fen, solution, theme, themes, difficulty, explanation, nb_plays, popularity, game_url, opening_tags)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (lichess_id) DO UPDATE SET
        fen = EXCLUDED.fen,
        solution = EXCLUDED.solution,
        theme = EXCLUDED.theme,
        themes = EXCLUDED.themes,
        difficulty = EXCLUDED.difficulty,
        nb_plays = EXCLUDED.nb_plays,
        popularity = EXCLUDED.popularity,
        game_url = EXCLUDED.game_url,
        opening_tags = EXCLUDED.opening_tags,
        is_published = puzzles.is_published
    `;
    const r = await client.query(sql, values);
    written += r.rowCount;
  }
  return written;
}

/* ──────── attempt a puzzle (student) ──────── */

exports.attemptPuzzle = async (req, res) => {
  try {
    const { moves, timeTaken } = req.body;
    const puzzleRes = await db.query('SELECT fen, solution, explanation FROM puzzles WHERE id = $1', [req.params.id]);
    if (puzzleRes.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });

    const row = puzzleRes.rows[0];
    let solution = row.solution;

    // Normalize legacy SAN solutions (and incoming moves) to UCI for comparison
    try { solution = toUCI(row.fen, row.solution); } catch { /* keep as-is */ }
    let played = Array.isArray(moves) ? moves : [];
    try { played = toUCI(row.fen, played); } catch { /* keep as-is */ }

    const isCorrect = JSON.stringify(played) === JSON.stringify(solution);
    const isPrefix = played.length < solution.length
      && JSON.stringify(solution.slice(0, played.length)) === JSON.stringify(played);

    // Only record a scored attempt when the puzzle is fully solved OR clearly failed.
    const incomplete = played.length > 0 && !isCorrect && isPrefix;
    const failed = !isCorrect && !isPrefix && played.length > 0;

    // Per-assignment configuration from the "Assign to Students" modal (hoisted so the
    // final response can report it even when no scored attempt was recorded).
    let assignmentConfig = { points: null, negativePoints: null, maxAttempts: null, timeLimitSeconds: null };
    let attemptsUsedTotal = 0;

    if (!incomplete) {
      const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
      const studentId = studentRes.rows[0]?.id;
      if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

      // The assignment this solve belongs to. The student UI always knows it:
      // Continue/View opens one exact assignment card and solves inside it.
      // When the client sends it, the attempt is linked to THAT assignment
      // (validated below) instead of being guessed — so two assignments that
      // share a puzzle folder can never credit each other's progress.
      // Absent (folder / free-range solving): legacy guess, unchanged.
      const requestedAssignmentId = Number(req.body?.assignmentId);
      const wantsTargeted = Number.isInteger(requestedAssignmentId) && requestedAssignmentId > 0;
      let targetedSubmission = null;
      if (wantsTargeted) {
        const mine = await db.query(
          `SELECT sub.id AS submission_id, sub.status
           FROM assignment_submissions sub
           JOIN assignment_puzzles ap ON ap.assignment_id = sub.assignment_id
           WHERE sub.student_id = $1 AND sub.assignment_id = $2 AND ap.puzzle_id = $3
           LIMIT 1`,
          [studentId, requestedAssignmentId, req.params.id]
        );
        if (mine.rows.length === 0) {
          return res.status(400).json({ message: 'This puzzle is not part of that assignment for you.' });
        }
        targetedSubmission = mine.rows[0];
        if (['submitted', 'reviewed'].includes(targetedSubmission.status)) {
          return res.status(403).json({
            message: 'This assignment has already been submitted. No further attempts allowed.',
            blocked: true,
            submitted: true,
          });
        }
      }

      // Check if this puzzle is part of a submitted assignment.
      // Scoped to the targeted assignment when the client names one: handing
      // in assignment A must never lock the same puzzle inside the still-open
      // assignment B. Only the legacy folder path keeps the old global check.
      const submissionCheck = wantsTargeted
        ? { rows: [] }
        : await db.query(
          `SELECT sub.id
         FROM assignment_submissions sub
         JOIN assignment_puzzles ap ON ap.assignment_id = sub.assignment_id
         WHERE sub.student_id = $1 AND ap.puzzle_id = $2 AND sub.status IN ('submitted', 'reviewed')
         LIMIT 1`,
          [studentId, req.params.id]
        );
      if (submissionCheck.rows.length > 0) {
        return res.status(403).json({
          message: 'This puzzle is part of an assignment that has already been submitted. No further attempts allowed.',
          blocked: true,
          submitted: true,
        });
      }

      const assignRes = await db.query(
        `SELECT id, points, max_attempts, negative_points, time_limit_seconds, status
         FROM student_puzzle_assignments
         WHERE student_id = $1 AND puzzle_id = $2`,
        [studentId, req.params.id]
      );
      const assignment = assignRes.rows[0] || null;

      const attemptsRes = await db.query(
        `SELECT COALESCE(COUNT(*), 0)::int AS c, COALESCE(MAX(attempt_no), 0)::int AS max_no
         FROM puzzle_attempts WHERE puzzle_id = $1 AND student_id = $2`,
        [req.params.id, studentId]
      );
      const attemptsUsed = attemptsRes.rows[0].c;
      attemptsUsedTotal = attemptsUsed;
      const alreadySolved = !!(
        await db.query(
          'SELECT 1 FROM puzzle_attempts WHERE puzzle_id = $1 AND student_id = $2 AND result = $3 LIMIT 1',
          [req.params.id, studentId, 'correct']
        )
      ).rows.length;

      const maxAttempts = assignment && assignment.max_attempts != null ? assignment.max_attempts : null;
      const points = assignment && assignment.points != null && assignment.points >= 0 ? assignment.points : 10;
      const negativePoints = assignment && assignment.negative_points != null ? Math.max(0, assignment.negative_points) : 0;
      assignmentConfig = {
        points,
        negativePoints,
        maxAttempts,
        timeLimitSeconds: assignment ? assignment.time_limit_seconds : null,
      };

      // Enforce the per-assignment attempt cap (legacy/unlimited assignments are not capped).
      if (assignmentConfig.maxAttempts != null && attemptsUsed >= assignmentConfig.maxAttempts && !alreadySolved) {
        return res.json({
          correct: false,
          complete: false,
          blocked: true,
          attemptsExhausted: true,
          message: 'No attempts left for this puzzle.',
          attemptsUsed,
          maxAttempts: assignmentConfig.maxAttempts,
          timeLimitSeconds: assignmentConfig.timeLimitSeconds,
          solution,
          explanation: row.explanation,
        });
      }

      if (isCorrect || failed) {
        const nextAttemptNo = Math.max(attemptsUsed + 1, (attemptsRes.rows[0].max_no || 0) + 1);
        let score = 0;
        let pointsEarned = 0;
        if (isCorrect) {
          if (!alreadySolved) pointsEarned = points;
          score = pointsEarned;
        } else if (failed) {
          pointsEarned = negativePoints > 0 ? -negativePoints : 0;
          score = pointsEarned;
        }

        // Link the attempt back to its coach assignment, if this puzzle is part
        // of one the student was given. Without this the coach's review screen
        // (which filters on puzzle_assignment_id) sees no attempts at all.
        // A client-supplied assignment (validated above) always wins: the
        // student is solving inside that exact assignment card. Otherwise fall
        // back to the legacy guess below. Where a puzzle belongs to several of
        // a student's assignments, an already handed-in one is never chosen to
        // host the new attempt.
        const link = wantsTargeted
          ? { rows: [{ assignment_id: requestedAssignmentId }] }
          : await db.query(
            `SELECT ap.assignment_id
             FROM assignment_puzzles ap
             JOIN assignment_submissions s
               ON s.assignment_id = ap.assignment_id AND s.student_id = $2
             WHERE ap.puzzle_id = $1
             ORDER BY CASE WHEN s.status IN ('submitted', 'reviewed') THEN 1 ELSE 0 END,
                      ap.assignment_id
             LIMIT 1`,
            [req.params.id, studentId]
          );
        const assignmentId = link.rows[0]?.assignment_id ?? null;

        await db.query(
          `INSERT INTO puzzle_attempts (puzzle_id, student_id, result, score, time_taken, attempt_no, points_earned, played_moves, puzzle_assignment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [req.params.id, studentId, isCorrect ? 'correct' : 'incorrect', score, timeTaken || null, nextAttemptNo, pointsEarned, played, assignmentId]
        );

        // Keep the assignment submission's progress in step with the puzzle, so
        // the coach's tracker shows "X of Y puzzles" without a separate job.
        //
        // Attempts must NEVER mark a submission "submitted" or write
        // submitted_at — that is the explicit Submit Assignment action's job.
        // Solving/attempting only promotes a pending assignment to
        // in_progress; progress_completed counts distinct CORRECT solves from
        // the attempt data itself (0 solved never reads as completed).
        if (assignmentId) {
          await db.query(
            `UPDATE assignment_submissions
             SET progress_completed = (
                   SELECT COUNT(DISTINCT pa2.puzzle_id)::int
                   FROM puzzle_attempts pa2
                   WHERE pa2.student_id = $2
                     AND pa2.puzzle_assignment_id = $1
                     AND pa2.result = 'correct'
                 ),
                 status = CASE
                   WHEN assignment_submissions.status = 'pending' THEN 'in_progress'
                   ELSE assignment_submissions.status
                 END
             WHERE assignment_id = $1 AND student_id = $2`,
            [assignmentId, studentId]
          );
        }
      }

      if (isCorrect) {
        await db.query('UPDATE puzzles SET nb_plays = nb_plays + 1 WHERE id = $1', [req.params.id]);
        await db.query(
          `UPDATE student_puzzle_assignments
           SET status = 'completed'
           WHERE student_id = $1 AND puzzle_id = $2`,
          [studentId, req.params.id]
        );
      }
    }

    res.json({
      correct: isCorrect,
      complete: isCorrect || failed,
      blocked: false,
      attemptsExhausted: false,
      solution,
      explanation: row.explanation,
      score: isCorrect
        ? (assignmentConfig.points != null ? assignmentConfig.points : 10)
        : (failed ? -(assignmentConfig.negativePoints || 0) : 0),
      pointsEarned: isCorrect
        ? (assignmentConfig.points != null ? assignmentConfig.points : 10)
        : (failed ? -(assignmentConfig.negativePoints || 0) : 0),
      attemptsUsed: attemptsUsedTotal + (isCorrect || failed ? 1 : 0),
      maxAttempts: assignmentConfig.maxAttempts,
      timeLimitSeconds: assignmentConfig.timeLimitSeconds,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to record puzzle attempt', error: err.message });
  }
};

/* ──────────────── set all puzzles unpublished (assignment isolation) ──────────────── */

exports.unpublishAll = async (_req, res) => {
  try {
    await db.query('UPDATE puzzles SET is_published = false');
    res.json({ message: 'All puzzles unpublished' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to unpublish puzzles', error: err.message });
  }
};

/* ──────────────── list who a puzzle is assigned to ──────────────── */

exports.getAssignments = async (req, res) => {
  try {
    const puzzleRes = await db.query('SELECT id, fen, theme, is_published FROM puzzles WHERE id = $1', [req.params.id]);
    if (puzzleRes.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });

    const rows = await db.query(
      `SELECT pa.student_id, u.name, pa.assigned_at
       FROM puzzle_assignments pa
       LEFT JOIN students s ON s.id = pa.student_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE pa.puzzle_id = $1
       ORDER BY pa.assigned_at DESC`,
      [req.params.id]
    );

    const hasAll = rows.rows.some((r) => r.student_id === null);
    const students = rows.rows.filter((r) => r.student_id !== null).map((r) => ({
      student_id: r.student_id,
      name: r.name,
      assigned_at: r.assigned_at,
    }));

    res.json({ puzzle: puzzleRes.rows[0], all_students: hasAll, students });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load assignments', error: err.message });
  }
};

/* ──────────────── (re)assign a puzzle to students / all students ──────────────── */

exports.assignPuzzle = async (req, res) => {
  try {
    const { all_students = false, student_ids = [], is_published = true } = req.body;
    const puzzleId = req.params.id;

    const exists = await db.query('SELECT id FROM puzzles WHERE id = $1', [puzzleId]);
    if (exists.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });

    // Start fresh: drop every assignment row for this puzzle (legacy + canonical).
    await db.query('DELETE FROM puzzle_assignments WHERE puzzle_id = $1', [puzzleId]);
    await db.query('DELETE FROM student_puzzle_assignments WHERE puzzle_id = $1', [puzzleId]);

    if (all_students) {
      await db.query(
        'INSERT INTO puzzle_assignments (puzzle_id, student_id) VALUES ($1, NULL)',
        [puzzleId]
      );
      await db.query(
        `INSERT INTO student_puzzle_assignments (student_id, puzzle_id, assigned_date, status, assigned_by)
         SELECT s.id, $1, CURRENT_DATE, 'assigned', $2
         FROM students s
         ON CONFLICT (student_id, puzzle_id) DO NOTHING`,
        [puzzleId, req.user.id]
      );
    } else {
      const ids = Array.isArray(student_ids) ? [...new Set(student_ids)].filter(Number.isInteger) : [];
      for (const sid of ids) {
        await db.query(
          'INSERT INTO puzzle_assignments (puzzle_id, student_id) VALUES ($1, $2)',
          [puzzleId, sid]
        );
        await db.query(
          `INSERT INTO student_puzzle_assignments (student_id, puzzle_id, assigned_date, status, assigned_by)
           VALUES ($1, $2, CURRENT_DATE, 'assigned', $3)
           ON CONFLICT (student_id, puzzle_id) DO NOTHING`,
          [sid, puzzleId, req.user.id]
        );
      }
    }

    // Auto-publish so assigned students immediately see the puzzle.
    await db.query('UPDATE puzzles SET is_published = $1 WHERE id = $2', [is_published, puzzleId]);

    res.json({ message: 'Assigned', puzzle_id: puzzleId, all_students, assigned: all_students ? 'all' : student_ids.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to assign puzzle', error: err.message });
  }
};

/* ──────────────── list puzzles assigned to the logged-in student (with status) ──────────────── */

/* ──────────────── per-puzzle assignment + attempt results (admin) ──────────────── */

exports.getAssignmentResults = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        p.id,
        p.theme,
        p.title,
        p.set_code,
        p.difficulty,
        p.is_published,
        p.created_at,
        s.name AS set_name,
        f.name AS folder_name,
        (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq,
        COUNT(DISTINCT pa.id) FILTER (WHERE pa.student_id IS NULL)                       AS assigned_all,
        COUNT(DISTINCT pa2.id)                                                            AS assigned_count,
        COUNT(DISTINCT spa.id)                                                            AS assigned_students,
        COUNT(DISTINCT at.id)                                                             AS attempt_count,
        COUNT(DISTINCT at.id) FILTER (WHERE at.result = 'correct')                        AS correct_count,
        COUNT(DISTINCT at.id) FILTER (WHERE at.result = 'incorrect')                      AS incorrect_count,
        COUNT(DISTINCT st.id) FILTER (WHERE at.result IS NOT NULL)                        AS students_attempted
      FROM puzzles p
      LEFT JOIN sets s                  ON s.code = p.set_code
      LEFT JOIN set_folders f           ON f.id = s.folder_id
      LEFT JOIN puzzle_assignments pa   ON pa.puzzle_id = p.id
      LEFT JOIN puzzle_assignments pa2  ON pa2.puzzle_id = p.id AND pa2.student_id IS NOT NULL
      LEFT JOIN student_puzzle_assignments spa ON spa.puzzle_id = p.id
      LEFT JOIN puzzle_attempts at      ON at.puzzle_id = p.id
      LEFT JOIN students st             ON st.id = at.student_id
      GROUP BY p.id, s.name, f.name
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load assignment results', error: err.message });
  }
};

/* ──────────────── per-student attempt detail for a given puzzle (admin results) ──────────────── */

exports.getPuzzleResults = async (req, res) => {
  try {
    const puzzle = await db.query('SELECT id, fen, theme FROM puzzles WHERE id = $1', [req.params.id]);
    if (puzzle.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });

    const rows = await db.query(
      `SELECT at.student_id, u.name, at.result, at.score, at.time_taken, at.attempted_at,
              COUNT(*) OVER (PARTITION BY at.student_id) AS attempts
       FROM puzzle_attempts at
       JOIN students s ON s.id = at.student_id
       JOIN users u ON u.id = s.user_id
       WHERE at.puzzle_id = $1
       ORDER BY at.attempted_at DESC`,
      [req.params.id]
    );

    res.json({ puzzle: puzzle.rows[0], attempts: rows.rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle results', error: err.message });
  }
};

/* ──────────────── per-student puzzle completion overview (admin analysis) ──────────────── */

exports.getCompletion = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT s.id AS student_id, u.name,
              (SELECT COUNT(*) FROM puzzles WHERE is_published = true) AS total_puzzles,
              COUNT(DISTINCT pa.id) AS attempted,
              COUNT(DISTINCT pa.id) FILTER (WHERE pa.result = 'correct') AS solved,
              COALESCE(SUM(pa.score) FILTER (WHERE pa.result = 'correct'), 0) AS points
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN puzzle_attempts pa ON pa.student_id = s.id
       GROUP BY s.id, u.name
       ORDER BY solved DESC, u.name ASC`
    );

    const solvedPuzzles = await db.query(
      `SELECT pa.student_id, p.id AS puzzle_id, p.theme, p.difficulty
       FROM puzzle_attempts pa
       JOIN puzzles p ON p.id = pa.puzzle_id
       WHERE pa.result = 'correct'
       ORDER BY p.id`
    );

    const byStudent = {};
    for (const sp of solvedPuzzles.rows) {
      if (!byStudent[sp.student_id]) byStudent[sp.student_id] = [];
      byStudent[sp.student_id].push({ id: sp.puzzle_id, theme: sp.theme, difficulty: sp.difficulty });
    }

    res.json({
      students: rows.rows.map((r) => ({ ...r, solved_puzzles: byStudent[r.student_id] || [] })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle completion', error: err.message });
  }
};

/* ──────────────── student-wise puzzle solving report (admin) ──────────────── */

/**
 * One row per student summarising their puzzle solving, plus a per-puzzle
 * breakdown covering every puzzle assigned to them *or* that they attempted.
 * This is the student-centric counterpart to `getAssignmentResults`, which is
 * puzzle-centric.
 *
 * Assignment counts merge both sources: the legacy visibility table
 * (`puzzle_assignments`, including the `student_id IS NULL` "all students"
 * broadcast row) and the canonical `student_puzzle_assignments`.
 */
exports.getStudentPuzzleReport = async (_req, res) => {
  try {
    const summary = await db.query(
      `WITH legacy AS (
         SELECT student_id, puzzle_id FROM puzzle_assignments WHERE student_id IS NOT NULL
       ),
       per_student AS (
         SELECT student_id, COUNT(DISTINCT puzzle_id) AS legacy_assigned
         FROM legacy GROUP BY student_id
       ),
       broadcast AS (
         SELECT s.id AS student_id, COUNT(DISTINCT pa.puzzle_id) AS assigned_broadcast
         FROM students s
         JOIN puzzle_assignments pa ON pa.student_id IS NULL
         GROUP BY s.id
       ),
       att AS (
         SELECT student_id,
                COUNT(*)::int                                        AS attempts,
                COUNT(*) FILTER (WHERE result = 'correct')::int      AS correct,
                COUNT(*) FILTER (WHERE result = 'incorrect')::int    AS incorrect,
                COUNT(DISTINCT puzzle_id)::int                       AS puzzles_attempted,
                COUNT(DISTINCT puzzle_id) FILTER (WHERE result = 'correct')::int AS puzzles_solved,
                COALESCE(SUM(points_earned), 0)::int                  AS points,
                ROUND(AVG(time_taken))::int                          AS avg_time,
                MAX(attempted_at)                                    AS last_attempt_at
         FROM puzzle_attempts
         WHERE student_id IS NOT NULL
         GROUP BY student_id
       )
       SELECT s.id AS student_id, u.name, u.email, g.name AS group_name, s.active,
              (SELECT COUNT(DISTINCT spa.puzzle_id) FROM student_puzzle_assignments spa
                WHERE spa.student_id = s.id)::int     AS assigned_explicit,
              COALESCE(b.assigned_broadcast, 0)::int  AS assigned_broadcast,
              COALESCE(ps.legacy_assigned, 0)::int    AS legacy_assigned,
              COALESCE(at.attempts, 0)                AS attempts,
              COALESCE(at.correct, 0)                 AS correct,
              COALESCE(at.incorrect, 0)               AS incorrect,
              COALESCE(at.puzzles_attempted, 0)       AS puzzles_attempted,
              COALESCE(at.puzzles_solved, 0)          AS puzzles_solved,
              COALESCE(at.points, 0)                  AS points,
              at.avg_time,
              at.last_attempt_at
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g       ON g.id = s.group_id
       LEFT JOIN broadcast b    ON b.student_id = s.id
       LEFT JOIN per_student ps ON ps.student_id = s.id
       LEFT JOIN att at         ON at.student_id = s.id
       ORDER BY u.name ASC`
    );

    const breakdown = await db.query(
      `WITH my_puzzles AS (
         SELECT spa.student_id, spa.puzzle_id, true AS is_explicit, false AS is_broadcast,
                spa.status AS assignment_status, spa.due_date
         FROM student_puzzle_assignments spa
         UNION
         SELECT pa.student_id, pa.puzzle_id, false, true, NULL, NULL
         FROM puzzle_assignments pa
         WHERE pa.student_id IS NOT NULL
         UNION
         -- puzzles broadcast to every student (puzzle_assignments row with no student)
         SELECT s.id, pa.puzzle_id, false, true, NULL, NULL
         FROM students s
         JOIN puzzle_assignments pa ON pa.student_id IS NULL
       ),
       att AS (
         SELECT student_id, puzzle_id,
                COUNT(*)::int                      AS attempts,
                COUNT(*) FILTER (WHERE result = 'correct')::int AS correct,
                MAX(score)::int                    AS best_score,
                COALESCE(SUM(points_earned), 0)::int AS points,
                MAX(attempted_at)                  AS last_attempt_at,
                BOOL_OR(result = 'correct')        AS solved
         FROM puzzle_attempts
         WHERE student_id IS NOT NULL
         GROUP BY student_id, puzzle_id
       )
       SELECT mp.student_id, p.id AS puzzle_id, p.theme, p.difficulty, p.is_published,
              p.set_code, st.name AS set_name, st.folder_id, f.name AS folder_name,
              mp.assignment_status, mp.due_date,
              (mp.is_explicit OR mp.is_broadcast) AS is_assigned,
              mp.is_explicit,
              (a.puzzle_id IS NOT NULL)      AS attempted,
              COALESCE(a.solved, false)      AS solved,
              COALESCE(a.attempts, 0)        AS attempts,
              COALESCE(a.correct, 0)         AS correct,
              COALESCE(a.best_score, 0)      AS best_score,
              COALESCE(a.points, 0)          AS points,
              a.last_attempt_at
       FROM my_puzzles mp
       JOIN puzzles p ON p.id = mp.puzzle_id
       LEFT JOIN sets st     ON st.code = p.set_code
       LEFT JOIN set_folders f ON f.id = st.folder_id
       LEFT JOIN att a ON a.student_id = mp.student_id AND a.puzzle_id = mp.puzzle_id
       UNION
       -- attempts on puzzles that were never formally assigned
       SELECT a.student_id, p.id, p.theme, p.difficulty, p.is_published,
              p.set_code, st.name, st.folder_id, f.name,
              NULL, NULL,
              false, false,
              true, COALESCE(a.solved, false), a.attempts, a.correct,
              COALESCE(a.best_score, 0), COALESCE(a.points, 0), a.last_attempt_at
       FROM att a
       JOIN puzzles p ON p.id = a.puzzle_id
       LEFT JOIN sets st     ON st.code = p.set_code
       LEFT JOIN set_folders f ON f.id = st.folder_id
       WHERE NOT EXISTS (
         SELECT 1 FROM my_puzzles mp
         WHERE mp.student_id = a.student_id AND mp.puzzle_id = a.puzzle_id
       )
       ORDER BY 2`
    );

    // Distinct set/folder pairs for the filter dropdowns, sorted for stable rendering.
    const setIndex = new Map();
    for (const row of breakdown.rows) {
      if (!row.set_code) continue;
      if (!setIndex.has(row.set_code)) {
        setIndex.set(row.set_code, {
          set_code: row.set_code,
          set_name: row.set_name || row.set_code,
          folder_id: row.folder_id ?? null,
          folder_name: row.folder_name || null,
        });
      }
    }
    const sets = [...setIndex.values()].sort((a, b) => a.set_name.localeCompare(b.set_name));

    const byStudent = {};
    for (const row of breakdown.rows) {
      (byStudent[row.student_id] ||= []).push(row);
    }

    res.json({
      sets,
      students: summary.rows.map((r) => {
        const puzzles = byStudent[r.student_id] || [];
        // Derive every count from the deduplicated breakdown so the totals always
        // agree with the rows shown in the expanded detail.
        const assigned = puzzles.filter((p) => p.is_assigned).length;
        const solved = puzzles.filter((p) => p.solved).length;
        const attempted = puzzles.filter((p) => p.attempted).length;
        const pending = Math.max(assigned - solved, 0);

        // Finish status: completed once every assigned puzzle is solved.
        let finish_status = 'not_started';
        if (assigned > 0 && pending === 0) finish_status = 'completed';
        else if (solved > 0) finish_status = 'in_progress';

        // Per-set rollup so the UI can show folder → set → progress.
        const setMap = new Map();
        for (const p of puzzles) {
          if (!p.set_code) continue;
          if (!setMap.has(p.set_code)) {
            setMap.set(p.set_code, {
              set_code: p.set_code,
              set_name: p.set_name || p.set_code,
              folder_id: p.folder_id ?? null,
              folder_name: p.folder_name || null,
              assigned: 0, solved: 0, attempted: 0, points: 0, correct: 0, attempts: 0,
            });
          }
          const s = setMap.get(p.set_code);
          if (p.is_assigned) s.assigned += 1;
          if (p.solved) s.solved += 1;
          if (p.attempted) s.attempted += 1;
          s.points += p.points || 0;
          s.correct += p.correct || 0;
          s.attempts += p.attempts || 0;
        }
        const set_progress = [...setMap.values()]
          .map((s) => ({
            ...s,
            pending: Math.max(s.assigned - s.solved, 0),
            pct: s.assigned > 0 ? Math.round((s.solved / s.assigned) * 100) : 0,
            accuracy: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
          }))
          .sort((a, b) =>
            (a.folder_name || '').localeCompare(b.folder_name || '') || a.set_name.localeCompare(b.set_name)
          );

        return {
          ...r,
          puzzles,
          set_progress,
          assigned_count: assigned,
          puzzles_solved: solved,
          puzzles_attempted: attempted,
          puzzles_pending: pending,
          finish_status,
          finish_pct: assigned > 0 ? Math.round((solved / assigned) * 100) : 0,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load student puzzle report', error: err.message });
  }
};

/* Rename a set — keeps set_code (and therefore every puzzle/assignment
   reference) intact; only the display label changes. */
exports.renameSet = async (req, res) => {
  try {
    const code = String(req.params.setCode || '').trim();
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Set name is required and cannot be empty' });
    if (name.length > 200) return res.status(400).json({ message: 'Set name must be at most 200 characters' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const setRes = await client.query('SELECT code, type_tag FROM sets WHERE code = $1', [code]);
      if (setRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Puzzle set not found' });
      }

      const renamed = await client.query(
        'UPDATE sets SET name = $1, updated_at = NOW() WHERE code = $2 RETURNING code AS set_code, name AS set_name',
        [name, code]
      );

      /* Renaming a user's own puzzle set (CST = CSV-imported / Library uploads)
         carries through to its puzzle titles — "{new name} #1..N" in set order,
         mirroring how the Library names its entries. Curated theme sets keep
         their hand-authored titles. */
      let puzzlesRenamed = 0;
      if (setRes.rows[0].type_tag === 'CST') {
        const upd = await client.query(
          `UPDATE puzzles p
             SET title = n.set_name || ' #' || x.seq::text, updated_at = NOW()
             FROM (VALUES ($2::text)) AS n(set_name),
                  (SELECT id, (ROW_NUMBER() OVER (ORDER BY COALESCE(order_index, 0) ASC NULLS LAST, id))::int AS seq
                   FROM puzzles WHERE set_code = $1) AS x
             WHERE p.id = x.id`,
          [code, name]
        );
        puzzlesRenamed = upd.rowCount;
      }

      await client.query('COMMIT');
      res.json({ set: { set_code: renamed.rows[0].set_code, set_name: renamed.rows[0].set_name }, puzzlesRenamed });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Failed to rename set', error: err.message });
  }
};

/* Delete a puzzle set and every puzzle belonging to it, atomically.
   Returns the count of puzzles removed so the frontend can confirm the
   impact. 404 when the set_code doesn't exist. */
exports.deleteSet = async (req, res) => {
  const code = String(req.params.setCode || '').trim();
  if (!code) return res.status(400).json({ message: 'Set code is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setRes = await client.query(
      'SELECT code, name FROM sets WHERE code = $1',
      [code]
    );
    if (setRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Puzzle set not found' });
    }

    const setName = setRes.rows[0].name;
    const delPuzzles = await client.query(
      'DELETE FROM puzzles WHERE set_code = $1',
      [code]
    );
    const puzzlesDeleted = delPuzzles.rowCount;

    await client.query('DELETE FROM sets WHERE code = $1', [code]);
    await client.query('COMMIT');

    res.json({
      message: `Set "${setName}" deleted`,
      set_code: code,
      set_name: setName,
      puzzles_deleted: puzzlesDeleted,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Failed to delete puzzle set', error: err.message });
  } finally {
    client.release();
  }
};

/* Delete a puzzle set and all its puzzles in one atomic transaction.
   Returns the count of removed puzzles so the frontend can confirm. */
exports.deleteSet = async (req, res) => {
  const code = String(req.params.setCode || '').trim();
  if (!code) return res.status(400).json({ message: 'Set code is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Verify the set exists (and get its name for the response). */
    const setRes = await client.query(
      'SELECT code, name FROM sets WHERE code = $1', [code]
    );
    if (setRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Puzzle set not found' });
    }

    const { name } = setRes.rows[0];

    /* Cascade: delete every puzzle in this set first (child rows). */
    const delPuzzles = await client.query(
      'DELETE FROM puzzles WHERE set_code = $1', [code]
    );
    const puzzlesDeleted = delPuzzles.rowCount;

    /* Then delete the set row itself. */
    await client.query('DELETE FROM sets WHERE code = $1', [code]);

    await client.query('COMMIT');
    res.json({
      message: `Set "${name}" deleted`,
      set_code: code,
      set_name: name,
      puzzles_deleted: puzzlesDeleted,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Failed to delete puzzle set', error: err.message });
  } finally {
    client.release();
  }
};

/* Shared helpers (also used by the one-time set-merging migration runner). */
exports.TYPE_SETS = TYPE_SETS;
exports.puzzleTypeFromTheme = puzzleTypeFromTheme;
exports.codeForTag = codeForTag;
exports.syncPuzzleSets = syncPuzzleSets;

/* ═══════════════════════ CSV BULK IMPORT INTO A SINGLE SET ═══════════════════════
 *
 * New dedicated flow. One CSV file → ONE puzzle set/folder (coach-supplied name),
 * row order preserved via puzzles.order_index, each puzzle carrying its own
 * puzzles.title. Rows that fail FEN/move validation are skipped and reported,
 * never blocking the good rows. Large files run as a lightweight in-memory job
 * the frontend polls for progress (no queue dependency required).
 *
 * SQL columns rely on the migration `add_puzzle_set_import.sql`
 * (puzzles.title, puzzles.order_index, puzzles.rating).
 */

/* -- in-memory job store: id -> job -------------------------------------------- */
const importJobs = new Map();
const importJobSeq = { n: 0 };

function nextJobId() {
  return `setimp_${Date.now().toString(36)}_${(importJobSeq.n++).toString(36)}`;
}

/* Quote-aware CSV parser → array of row objects keyed by header (normalized).
   Handles commas inside quoted fields, escaped quotes (""), CRLF, headers with
   spaces. Extra columns are carried as generic keys and simply ignored by the
   mapper. */
function parseCsvTable(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const rows = [];
  let current = [];
  let buffer = '';
  let inQuotes = false;

  const pushCell = () => {
    current.push(buffer);
    buffer = '';
  };
  const pushRow = () => {
    pushCell();
    if (current.some((c) => c.trim() !== '')) rows.push(current);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQuotes) {
        if (ch === '"') {
          if (line[j + 1] === '"') { buffer += '"'; j++; }
          else inQuotes = false;
        } else buffer += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        pushCell();
      } else if (ch === '\r') {
        // ignore
      } else {
        buffer += ch;
      }
    }
    if (inQuotes) {
      buffer += '\n'; // multiline quoted field
    } else {
      pushRow();
    }
  }
  if (buffer.trim() !== '' || current.length > 0) pushRow();
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = cells[i] != null ? cells[i] : ''; });
    return obj;
  });
}

/* Map a CSV row object to field values using the columnMap:
   { title, fen, moves, rating, themes } each = header key ("" = unset).
   The CSV parser stores row keys by their *normalized* header (lowercase,
   stripped of spaces/punctuation, e.g. "FEN"/"Puzzle Id" → "fen"/"puzzleid").
   The columnMap values come from the client and may carry the raw header casing
   ("FEN", "Moves", "PuzzleId"), so we normalize the mapped header before looking
   it up to stay consistent with the row keys. */
function normalizeKey(k) {
  return String(k || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function resolveMapped(row, columnMap, totals) {
  const get = (k) => {
    const hk = columnMap && columnMap[k] ? normalizeKey(columnMap[k]) : '';
    return hk && row[hk] != null ? String(row[hk]) : '';
  };
  const title = get('title').trim();
  const fenRaw = get('fen').trim();
  const movesRaw = get('moves').trim();
  const ratingRaw = get('rating').trim();
  const themesRaw = get('themes').trim();
  totals.row++;
  return { title, fenRaw, movesRaw, ratingRaw, themesRaw };
}

/* Validate one mapped row via chess.js. `movesAreDirect` = the Moves cell IS the
   solution (fen is already the puzzle position). Otherwise the first move is the
   trigger that builds the puzzle position (classic lichess). Returns
   { ok, puzzle } or { ok:false, error }. */
function validateMappedRow({ title, fenRaw, movesRaw, ratingRaw, themesRaw }, movesAreDirect, rowNumber) {
  if (!fenRaw && !movesRaw) return { ok: false, error: 'Empty row' };
  if (!fenRaw) return { ok: false, error: 'Missing FEN' };
  if (!movesRaw) return { ok: false, error: 'Missing Moves' };

  let chess1;
  try { chess1 = new Chess(fenRaw); } catch { return { ok: false, error: 'Invalid FEN position' }; }

  const allMoves = movesRaw.split(/[\s_,|]+/).filter(Boolean);
  if (allMoves.length === 0) return { ok: false, error: 'Missing Moves' };

  let puzzleFen;
  let uciSolution;
  if (movesAreDirect) {
    puzzleFen = chess1.fen();
    try { uciSolution = uciMovesFrom(puzzleFen, allMoves); }
    catch (e) { return { ok: false, error: `Illegal move — ${e.message}` }; }
  } else {
    if (allMoves.length < 2) return { ok: false, error: 'Moves need a trigger plus at least one solution move' };
    const trigger = allMoves[0];
    try {
      chess1.move(UCI_RE.test(trigger)
        ? { from: trigger.slice(0, 2), to: trigger.slice(2, 4), promotion: trigger.length > 4 ? trigger[4] : undefined }
        : trigger);
    } catch { return { ok: false, error: `Illegal trigger move "${trigger}"` }; }
    puzzleFen = chess1.fen();
    try { uciSolution = uciMovesFrom(puzzleFen, allMoves.slice(1)); }
    catch (e) { return { ok: false, error: `Illegal solution move — ${e.message}` }; }
  }

  const themeTags = themesRaw.split(/[\s_,|]+/).filter(Boolean).map((t) => t.toLowerCase());
  const firstTag = themeTags[0] || '';
  const primaryLabel = THEME_LABELS_FORWARD[firstTag] || firstTag || 'Tactics';

  return {
    ok: true,
    puzzle: {
      fen: puzzleFen,
      uciSolution,
      title: title || `Puzzle #${rowNumber}`,
      rating: ratingRaw !== '' && Number.isFinite(Number(ratingRaw)) ? Math.round(Number(ratingRaw)) : null,
      themes: themeTags,
      theme: primaryLabel,
      difficulty: 'Medium',
      is_published: true,
    },
  };
}

/* "{baseName} #{index}" — the same hash-style numbering the Library UI uses for
   bulk rename / CSV imports, so an optional Puzzle Name overrides per-row titles
   with a consistent, row-ordered scheme before the set is written. */
function nameWithNumbering(baseName, index) {
  return `${baseName} #${index}`;
}

/* Create (or reuse) a `sets` row for a user-titled import. Custom imports use a
   stable custom code (CSTxxxx) so a re-upload of the same title reuses the set.
   Keeps the existing type-derived sets untouched. */
async function ensureCustomSet(client, setTitle, folderId = null) {
  const cleaned = String(setTitle || '').trim();
  if (!cleaned) throw new Error('Set title is required');
  const tag = 'CST';
  let code = codeForTag(tag);
  // Collide well: keep a deterministic suffix from the title so each named set
  // maps to its own custom code (letters/numbers from the title only).
  const slug = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'set';
  code = `${tag}${slug}`;
  await client.query(
    `INSERT INTO sets (code, name, type_tag, folder_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW(), folder_id = EXCLUDED.folder_id`,
    [code, cleaned, tag, folderId]
  );
  return code;
}

/* Insert valid rows as one batch inside the caller's transaction, preserving
   CSV order via order_index 1..N and per-puzzle title/rating. */
async function writeSetPuzzleRows(client, setCode, rows) {
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (let k = 0; k < chunk.length; k++) {
      const tr = chunk[k];
      const orderIndex = i + k + 1;
      const row = [
        tr.puzzle.fen,
        JSON.stringify(tr.puzzle.uciSolution),
        tr.puzzle.theme,
        tr.puzzle.themes || [],
        tr.puzzle.difficulty,
        tr.puzzle.explanation || null,
        tr.puzzle.title,
        orderIndex,
        tr.puzzle.rating,
        setCode,
      ];
      placeholders.push(`(${row.map(() => `$${idx++}`).join(',')})`);
      values.push(...row);
    }
    const sql = `
      INSERT INTO puzzles (fen, solution, theme, themes, difficulty, explanation, title, order_index, rating, set_code)
      VALUES ${placeholders.join(',')}`;
    const r = await client.query(sql, values);
    inserted += r.rowCount;
  }
  return inserted;
}

/* ── POST /api/puzzles/import-csv-set ────────────────────────────────────────────
   Body: { csv, setTitle, columnMap, movesAreDirect, fileName }
   Creates a job, returns immediately with jobId; processing happens in the
   background and the frontend polls GET /import-jobs/:id for progress. */
exports.importCSVSet = async (req, res) => {
  const { csv, setTitle, columnMap = {}, movesAreDirect = true, fileName = 'puzzle-set-import.csv', puzzleName = '', folderId = null } = req.body;
  const nameBase = String(puzzleName || '').trim();
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ message: 'Provide a csv string' });
  }

  /* Optional destination folder (any depth). 404 if it doesn't exist — the
     picker always sends a live folder id, so this is a soft guard against
     stale UI. */
  let destFolderId = null;
  if (folderId != null && folderId !== '') {
    destFolderId = Number(folderId);
    if (!Number.isInteger(destFolderId) || destFolderId <= 0) {
      return res.status(400).json({ message: 'Invalid folder id' });
    }
    const { rows } = await db.query('SELECT id FROM set_folders WHERE id = $1', [destFolderId]);
    if (!rows.length) return res.status(404).json({ message: 'Destination folder does not exist' });
  }

  let rows;
  try { rows = parseCsvTable(csv); } catch (err) {
    return res.status(400).json({ message: 'Failed to parse CSV: ' + err.message });
  }
  if (rows.length === 0) return res.status(400).json({ message: 'CSV has no data rows (need a header row + at least one data row)' });

  const jobId = nextJobId();
  const job = {
    id: jobId,
    status: 'processing', // processing | done | error
    fileName,
    totalRows: rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    errors: [],       // { row, reason }
    setCode: null,
    setTitle: String(setTitle || '').trim(),
    folderId: destFolderId,
    startedAt: Date.now(),
    finishedAt: null,
  };
  importJobs.set(jobId, job);

  // Fire-and-forget; errors are captured on the job, not thrown to the client.
  (async () => {
    const client = await pool.connect();
    try {
      const totals = { row: 0 };
      const batch = [];
      const errors = [];
      let namingIndex = 0;
      for (const r of rows) {
        const mapped = resolveMapped(r, columnMap, totals);
        if (!mapped.fenRaw && !mapped.movesRaw) continue; // blank spacer rows — ignore silently
        const valid = validateMappedRow(mapped, movesAreDirect, totals.row + 1);
        if (!valid.ok) {
          errors.push({ row: totals.row + 1, reason: valid.error });
          job.processed++;
          job.skipped++;
          continue;
        }
        job.processed++;
        if (nameBase) valid.puzzle.title = nameWithNumbering(nameBase, ++namingIndex);
        batch.push(valid);
      }
      errors.forEach((e) => job.errors.push(e));

      await client.query('BEGIN');
      const setCode = await ensureCustomSet(client, job.setTitle, destFolderId);
      job.setCode = setCode;
      // The CSV is the source of truth for this custom set → re-uploads replace,
      // so re-importing a corrected file never stacks duplicates.
      await client.query('DELETE FROM puzzles WHERE set_code = $1', [setCode]);
      job.imported = await writeSetPuzzleRows(client, setCode, batch);
      await client.query('COMMIT');
      job.status = 'done';
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      job.status = 'error';
      job.error = err.message;
    } finally {
      client.release();
      job.finishedAt = Date.now();
    }
  })();

  res.status(202).json({ jobId, status: job.status, totalRows: job.totalRows, setTitle: job.setTitle });
};

/* ── GET /api/puzzles/import-jobs/:id ──────────────────────────────────────────── */
exports.getImportJob = (req, res) => {
  const job = importJobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ message: 'Import job not found' });
  res.json({
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    totalRows: job.totalRows,
    processed: job.processed,
    imported: job.imported,
    skipped: job.skipped,
    errors: job.errors,
    setCode: job.setCode,
    setTitle: job.setTitle,
    folderId: job.folderId ?? null,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
};

/* ── GET /api/puzzles/import-jobs/:id/errors.csv ────────────────────────────────
   Downloadable error report for re-upload after fixing. */
exports.downloadImportErrors = (req, res) => {
  const job = importJobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ message: 'Import job not found' });
  const lines = ['Row,Reason'];
  for (const e of job.errors) {
    lines.push(`${e.row},"${String(e.reason).replace(/"/g, '""')}"`);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="import-errors-${job.id}.csv"`);
  res.send(lines.join('\r\n'));
};

/* ── PATCH /api/puzzles/sets/:setCode/puzzles/:id ────────────────────────────────
   Post-import edit: update a puzzle's title / rating / order_index within its set. */
exports.updateSetPuzzle = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid puzzle id' });

    const title = req.body.title !== undefined ? String(req.body.title).trim() : undefined;
    const rating = req.body.rating !== undefined ? (req.body.rating === '' || req.body.rating === null ? null : Number(req.body.rating)) : undefined;
    const orderIndex = req.body.order_index !== undefined ? (req.body.order_index === '' || req.body.order_index === null ? null : Number(req.body.order_index)) : undefined;
    if (title !== undefined && title.length > 200) return res.status(400).json({ message: 'Title must be at most 200 characters' });
    if (rating !== undefined && Number.isFinite(rating) && (rating < 0 || rating > 5000)) return res.status(400).json({ message: 'Rating out of range' });

    const sets = [];
    const vals = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx++}`); vals.push(title || null); }
    if (rating !== undefined) { sets.push(`rating = $${idx++}`); vals.push(Number.isFinite(rating) ? rating : null); }
    if (orderIndex !== undefined) { sets.push(`order_index = $${idx++}`); vals.push(Number.isFinite(orderIndex) ? orderIndex : null); }
    if (sets.length === 0) return res.status(400).json({ message: 'Nothing to update' });
    vals.push(id);
    const setClause = sets.join(', ');

    const result = await db.query(
      `UPDATE puzzles SET ${setClause} WHERE id = $${idx} RETURNING id, title, rating, order_index, set_code`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });
    res.json({ puzzle: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update puzzle', error: err.message });
  }
};

/* ── POST /api/puzzles/sets/:setCode/reorder ────────────────────────────────────
   Bulk reorder within a custom set: body = { order: [5, 3, 1, ...] } a list of
   puzzle ids in their new order → order_index = position. */
exports.reorderSetPuzzles = async (req, res) => {
  try {
    const setCode = String(req.params.setCode || '').trim();
    const order = req.body.order;
    if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ message: 'Provide an order array of puzzle ids' });
    const ids = order.map(Number);
    if (ids.some((n) => !Number.isFinite(n))) return res.status(400).json({ message: 'Invalid puzzle id in order array' });

    const setRes = await db.query('SELECT code FROM sets WHERE code = $1', [setCode]);
    if (setRes.rows.length === 0) return res.status(404).json({ message: 'Puzzle set not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `UPDATE puzzles SET order_index = $1, updated_at = NOW()
           WHERE id = $2 AND set_code = $3`,
          [i + 1, ids[i], setCode]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ message: `Reordered ${ids.length} puzzle${ids.length === 1 ? '' : 's'}` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reorder puzzles', error: err.message });
  }
};

/* Test visibility (harmless). */
exports._parseCsvTable = parseCsvTable;
exports._validateMappedRow = validateMappedRow;

/* ensureCustomSet, writeSetPuzzleRows and toUCI used to be re-exported here for
   the PDF puzzle import flow. That flow is gone; the helpers are internal and
   are still used by the CSV/PGN import below, so only the cross-module exports
   were dropped. */