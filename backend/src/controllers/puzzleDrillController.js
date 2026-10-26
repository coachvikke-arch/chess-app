const db = require('../config/database');
const { Chess } = require('chess.js');
const { userIsMemberOfClass } = require('../services/liveClassAccess');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const RESULTS = ['solving', 'completed', 'failed', 'time_finished'];

/* Matches UCI long algebraic notation (e.g. e2e4, g7g8q). */
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/* Normalize a solution (SAN or UCI array/string) to a flat UCI array from `fen`. */
function toUCI(fen, moves) {
  const game = new Chess(fen);
  const out = [];
  for (const m of Array.isArray(moves) ? moves : String(moves ?? '').split(/[\s,]+/).filter(Boolean)) {
    const token = String(m).trim();
    let applied;
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

/* Replay a UCI line from `fen`, returning the SAN sequence. */
function replaySan(fen, uci) {
  const game = new Chess(fen);
  const out = [];
  for (const u of Array.isArray(uci) ? uci : []) {
    const mv = game.move({
      from: u.slice(0, 2),
      to: u.slice(2, 4),
      promotion: u.length > 4 ? u[4] : undefined,
    });
    if (mv) out.push(mv.san);
  }
  return out;
}

/* The UCI line this drill expects, or null when there is nothing to check
   against. Derived straight from the drill row rather than through
   buildDrillPayload, because saving progress happens on every single move and
   must not pay for the whole class roster each time. */
async function expectedSolutionUci(drillRow) {
  let fen = drillRow.puzzle_fen || null;
  let moves = drillRow.puzzle_solution;
  if (drillRow.puzzle_id) {
    const p = await db.query('SELECT fen, solution FROM puzzles WHERE id = $1', [drillRow.puzzle_id]);
    const row = p.rows[0];
    if (!row) return null;
    fen = fen || row.fen;
    moves = row.solution;
  }
  if (!fen) return null;
  const list = (Array.isArray(moves) ? moves : []).map(String).filter(Boolean);
  if (list.length === 0) return null;
  try {
    return toUCI(fen, list);
  } catch {
    /* An unplayable line cannot be used as a yardstick — better to record what
       the board said than to hand back nothing. */
    return list;
  }
}

function parseClampedInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max != null ? max : Infinity, n));
}

/* The member USER row for every student entitled to this class:
   explicit class_students when present, else the class group, else everyone. */
async function fetchClassMemberUsers(classRow) {
  const classId = classRow.id;
  const explicitRes = await db.query(
    'SELECT EXISTS (SELECT 1 FROM class_students WHERE class_id = $1) AS has_explicit',
    [classId]
  );
  const hasExplicit = explicitRes.rows[0].has_explicit;

  if (hasExplicit) {
    const res = await db.query(
      `SELECT u.id AS user_id, u.name
       FROM users u
       JOIN students s ON s.user_id = u.id
       JOIN class_students cs ON cs.student_id = s.id
       WHERE cs.class_id = $1
       ORDER BY u.name ASC`,
      [classId]
    );
    return res.rows;
  }

  if (classRow.group_id != null) {
    const res = await db.query(
      `SELECT u.id AS user_id, u.name
       FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE s.group_id = $1
       ORDER BY u.name ASC`,
      [classRow.group_id]
    );
    return res.rows;
  }

  const res = await db.query(
    `SELECT u.id AS user_id, u.name
     FROM users u
     JOIN students s ON s.user_id = u.id
     ORDER BY u.name ASC`
  );
  return res.rows;
}

/* Build the full drill payload for GET responses (shared by all drill endpoints). */
async function buildDrillPayload(drillRow, classRow) {
  const puzzleRes = drillRow.puzzle_id
    ? await db.query(
        `SELECT p.id, p.fen, p.solution, p.theme, p.difficulty, p.explanation, p.title,
                s.name AS set_name,
                (ROW_NUMBER() OVER (PARTITION BY p.set_code ORDER BY p.id))::int AS seq
         FROM puzzles p
         LEFT JOIN sets s ON s.code = p.set_code
         WHERE p.id = $1`,
        [drillRow.puzzle_id]
      )
    : null;
  const p = puzzleRes ? puzzleRes.rows[0] || null : null;

  let solution = [];
  let san = [];
  let fen = drillRow.puzzle_fen || (p ? p.fen : START_FEN);
  if (p) {
    try {
      solution = toUCI(fen, p.solution);
    } catch {
      solution = Array.isArray(p.solution) ? p.solution.map(String) : [];
    }
    try {
      san = replaySan(fen, solution);
    } catch {
      san = [];
    }
  } else if (drillRow.puzzle_fen) {
    try {
      solution = toUCI(fen, drillRow.puzzle_solution || []);
    } catch {
      solution = Array.isArray(drillRow.puzzle_solution) ? drillRow.puzzle_solution.map(String) : [];
    }
    try {
      san = replaySan(fen, solution);
    } catch {
      san = [];
    }
  }

  const nowMs = Date.now();
  const startedMs = new Date(drillRow.started_at).getTime();
  const limitMs = drillRow.time_limit_seconds != null ? drillRow.time_limit_seconds * 1000 : null;

  const members = await fetchClassMemberUsers(classRow);
  const progRes = await db.query(
    `SELECT user_id, result, moves, attempted, points_earned, solved_at, updated_at, wrong_moves
     FROM live_class_puzzle_progress
     WHERE drill_id = $1`,
    [drillRow.id]
  );
  const progByUser = new Map(progRes.rows.map((r) => [r.user_id, r]));

  const students = members.map((m) => {
    const row = progByUser.get(m.user_id);
    let result = row ? row.result : 'solving';
    let remainingMs = null;
    if (limitMs != null) {
      remainingMs = Math.max(0, limitMs - (nowMs - startedMs));
      // Flip to "Failed — Time Finished" on the board even if the student's
      // client never posted the timeout.
      if (result === 'solving' && remainingMs === 0) result = 'time_finished';
    }
    let moves = Array.isArray(row?.moves) ? row.moves : [];
    if (!Array.isArray(moves)) moves = [];
    const wrongMoves = Array.isArray(row?.wrong_moves) ? row.wrong_moves : [];
    return {
      userId: m.user_id,
      name: m.name,
      result,
      moves: moves.map(String),
      wrongMoves,
      attempted: row ? Number(row.attempted) || 0 : 0,
      pointsEarned: row ? Number(row.points_earned) || 0 : 0,
      remainingMs,
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    };
  });

  const title = drillRow.puzzle_title
    || (p ? (p.title || (p.set_name ? `${p.set_name} - ${p.seq}` : `Puzzle #${p.id}`)) : null);

  const puzzlePayload = p
    ? {
        id: p.id,
        title,
        setName: p.set_name,
        theme: p.theme,
        difficulty: p.difficulty,
        explanation: p.explanation,
        fen,
        solution,
        san,
      }
    : drillRow.puzzle_fen
      ? {
          id: null,
          title: title || 'Puzzle',
          setName: null,
          theme: null,
          difficulty: null,
          explanation: null,
          fen,
          solution,
          san,
        }
      : null;

  return {
    id: drillRow.id,
    status: drillRow.status,
    startedAt: new Date(drillRow.started_at).toISOString(),
    now: new Date().toISOString(),
    timeLimitSeconds: drillRow.time_limit_seconds,
    points: drillRow.points,
    negativePoints: drillRow.negative_points,
    maxAttempts: drillRow.max_attempts,
    puzzle: puzzlePayload,
    students,
  };
}

async function activeDrillForClass(classId) {
  const res = await db.query(
    `SELECT * FROM live_class_puzzle_drills
     WHERE live_class_id = $1 AND status = 'active'
     ORDER BY id DESC LIMIT 1`,
    [classId]
  );
  return res.rows[0] || null;
}

exports.getDrill = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) return res.status(403).json({ message: 'Forbidden' });

    const drillRow = await activeDrillForClass(classId);
    if (!drillRow) return res.json({ ok: true, isInstructor: access.isInstructor, drill: null });

    const drill = await buildDrillPayload(drillRow, classRow);
    res.json({ ok: true, isInstructor: access.isInstructor, drill });
  } catch (err) {
    console.error('[getDrill] error', err);
    res.status(500).json({ message: 'Failed to load puzzle drill', error: err.message });
  }
};

exports.startDrill = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Instructor only' });
    }

    // puzzleId (library puzzle) OR inline fen + solution + title ("Ask quiz"
    // started straight from a course file).
    const puzzleId = parseInt(req.body.puzzleId, 10);
    const inlineFen = typeof req.body.fen === 'string' ? req.body.fen.trim() : '';
    const inlineSolution = Array.isArray(req.body.solution)
      ? req.body.solution.filter((m) => typeof m === 'string').map((m) => m.trim()).filter(Boolean)
      : [];
    const inlineTitle = typeof req.body.title === 'string' ? req.body.title.trim() : null;

    let puzzleIdVal = null;
    let puzzleFenVal = null;
    let puzzleSolutionVal = null;
    let puzzleTitleVal = null;

    if (Number.isInteger(puzzleId) && puzzleId > 0) {
      const puzzleExists = await db.query('SELECT id FROM puzzles WHERE id = $1', [puzzleId]);
      if (puzzleExists.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });
      puzzleIdVal = puzzleId;
    } else if (inlineFen) {
      if (inlineSolution.length === 0) {
        return res.status(400).json({ message: 'fen and solution are required to ask a course-file puzzle' });
      }
      try {
        new Chess(inlineFen);
      } catch {
        return res.status(400).json({ message: 'Invalid puzzle position' });
      }
      try {
        puzzleSolutionVal = toUCI(inlineFen, inlineSolution);
      } catch (err) {
        return res.status(400).json({ message: err.message || 'Invalid solution line' });
      }
      puzzleFenVal = inlineFen;
      puzzleTitleVal = inlineTitle || null;
    } else {
      return res.status(400).json({ message: 'puzzleId or fen+solution is required' });
    }

    const timeRaw = req.body.timeLimitSeconds;
    const timeLimit = timeRaw === '' || timeRaw == null ? null : parseClampedInt(timeRaw, null, 0, null);
    const points = parseClampedInt(req.body.points, 10, 0, null);
    let maxAttempts = null; // "None" = unlimited retries
    if (req.body.maxAttempts !== '' && req.body.maxAttempts != null) {
      maxAttempts = parseClampedInt(req.body.maxAttempts, 3, 1, null);
    }
    const negativePoints = parseClampedInt(req.body.negativePoints, 0, 0, null);

    // Single active drill per class: ending any running drill first.
    await db.query(
      `UPDATE live_class_puzzle_drills
       SET status = 'ended', ended_at = NOW()
       WHERE live_class_id = $1 AND status = 'active'`,
      [classId]
    );

    const ins = await db.query(
      `INSERT INTO live_class_puzzle_drills
         (live_class_id, puzzle_id, puzzle_title, puzzle_fen, puzzle_solution,
          status, time_limit_seconds, points, max_attempts, negative_points, started_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', $6, $7, $8, $9, $10)
       RETURNING *`,
      [classId, puzzleIdVal, puzzleTitleVal, puzzleFenVal, JSON.stringify(puzzleSolutionVal),
       timeLimit, points, maxAttempts, negativePoints, req.user.id]
    );

    const drill = await buildDrillPayload(ins.rows[0], classRow);

    const io = req.app.get('io');
    if (io) io.to(`live-class:${classId}`).emit('puzzle_drill_started', { classId: Number(classId), drill });

    res.status(201).json({ ok: true, drill });
  } catch (err) {
    console.error('[startDrill] error', err);
    res.status(500).json({ message: 'Failed to start puzzle drill', error: err.message });
  }
};

exports.endDrill = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Instructor only' });
    }

    await db.query(
      `UPDATE live_class_puzzle_drills
       SET status = 'ended', ended_at = NOW()
       WHERE live_class_id = $1 AND status = 'active'`,
      [classId]
    );

    const io = req.app.get('io');
    if (io) io.to(`live-class:${classId}`).emit('puzzle_drill_ended', { classId: Number(classId) });

    res.json({ ok: true });
  } catch (err) {
    console.error('[endDrill] error', err);
    res.status(500).json({ message: 'Failed to end puzzle drill', error: err.message });
  }
};

exports.saveProgress = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) return res.status(403).json({ message: 'Forbidden' });

    const drillId = parseInt(req.body.drillId, 10);
    if (!Number.isInteger(drillId) || drillId <= 0) {
      return res.status(400).json({ message: 'drillId is required' });
    }

    const drillRes = await db.query(
      'SELECT * FROM live_class_puzzle_drills WHERE id = $1 AND live_class_id = $2',
      [drillId, classId]
    );
    if (drillRes.rows.length === 0) return res.status(404).json({ message: 'Drill not found' });
    const drill = drillRes.rows[0];
    if (drill.status !== 'active') return res.json({ ok: true, note: 'Drill already ended' });

    let result = String(req.body.result || 'solving');
    if (!RESULTS.includes(result)) result = 'solving';

    const moves = Array.isArray(req.body.moves)
      ? req.body.moves.filter((m) => typeof m === 'string').map((m) => m.trim()).filter(Boolean)
      : [];
    const attempted = Math.max(0, parseInt(req.body.attempted, 10) || 0);

    let wrongMoves = Array.isArray(req.body.wrongMoves)
      ? req.body.wrongMoves.filter((w) => w && typeof w.san === 'string').map((w) => ({ san: w.san.trim(), step: Math.max(0, parseInt(w.step, 10) || 0) }))
      : [];

    /* Retry: the student starts this puzzle over from their own card. Clears
     * THEIR ledger only — the drill and every other student's progress are the
     * instructor's to end. This has to bypass the "progress only grows" rule
     * below, or the line and the wrong guesses they are trying to get past could
     * never be cleared. */
    const isRetry = req.body.retry === true || req.body.retry === 'true';
    if (isRetry) {
      result = 'solving';
      moves = [];
      wrongMoves = [];
    }

    /* A drill is only COMPLETED once the whole line was played. The client
       claims the outcome, and a claim that is short of the line — a drifted move
       counter, a stale tab, a save that raced ahead — would otherwise hand out
       the points and close the drill on a solve the student never finished. */
    const expected = await expectedSolutionUci(drill);
    if (result === 'completed' && expected && moves.length < expected.length) {
      result = 'solving';
    }

    const existingRes = await db.query(
      `SELECT result, points_earned, solved_at FROM live_class_puzzle_progress
       WHERE drill_id = $1 AND user_id = $2`,
      [drillId, req.user.id]
    );
    const existing = existingRes.rows[0] || null;

    // Points always come from the server config.
    let pointsEarned = existing ? Number(existing.points_earned) || 0 : 0;
    let solvedAt = existing ? existing.solved_at : null;
    if (isRetry) {
      /* A retry un-earns the previous solve: the points came from a line the
         student has chosen to discard, and the solve time with it. */
      pointsEarned = 0;
      solvedAt = null;
    } else if (result === 'completed') {
      pointsEarned = drill.points;
      solvedAt = existing?.solved_at || new Date();
    } else if (result === 'failed') {
      pointsEarned = drill.negative_points > 0 ? -drill.negative_points : 0;
    }

    await db.query(
      `INSERT INTO live_class_puzzle_progress
         (drill_id, user_id, result, moves, attempted, points_earned, solved_at, updated_at, wrong_moves)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW(), $8::jsonb)
ON CONFLICT (drill_id, user_id) DO UPDATE SET
          /* Every monotonic rule below is suspended for one explicit retry,
             otherwise a student who pressed Retry could never actually clear the
             line and the wrong guesses they are trying to get past. Everything
             else about a retry is unchanged: it is still their own row. */
          result    = CASE WHEN $9::boolean THEN EXCLUDED.result
                           WHEN live_class_puzzle_progress.result = 'completed'
                           THEN 'completed' ELSE EXCLUDED.result END,
          /* Progress only ever grows. Saves are posted per move and can land out
             of order, so a late shorter one must not truncate the line the
             class is watching — a solved drill that showed two moves of a
             three-move mate reads exactly like a puzzle that ended early. */
          moves     = CASE WHEN $9::boolean THEN EXCLUDED.moves
                           WHEN jsonb_array_length(EXCLUDED.moves)
                              >= jsonb_array_length(live_class_puzzle_progress.moves)
                           THEN EXCLUDED.moves ELSE live_class_puzzle_progress.moves END,
          attempted = CASE WHEN $9::boolean THEN EXCLUDED.attempted
                           ELSE GREATEST(live_class_puzzle_progress.attempted, EXCLUDED.attempted) END,
          points_earned = CASE WHEN $9::boolean THEN EXCLUDED.points_earned
                               WHEN live_class_puzzle_progress.result = 'completed'
                               THEN live_class_puzzle_progress.points_earned
                               ELSE EXCLUDED.points_earned END,
          solved_at = CASE WHEN $9::boolean THEN EXCLUDED.solved_at
                           ELSE COALESCE(live_class_puzzle_progress.solved_at, EXCLUDED.solved_at) END,
          wrong_moves = CASE WHEN $9::boolean THEN EXCLUDED.wrong_moves
                             WHEN jsonb_array_length(EXCLUDED.wrong_moves)
                                >= jsonb_array_length(live_class_puzzle_progress.wrong_moves)
                             THEN EXCLUDED.wrong_moves ELSE live_class_puzzle_progress.wrong_moves END,
          updated_at = NOW()`,
      [drillId, req.user.id, result, JSON.stringify(moves), attempted, pointsEarned, solvedAt, JSON.stringify(wrongMoves), isRetry]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`live-class:${classId}`).emit('puzzle_drill_progress', {
        classId: Number(classId),
        drillId,
        userId: req.user.id,
        result,
        moves,
        attempted,
        wrongMoves,
        pointsEarned,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[saveProgress] error', err);
    res.status(500).json({ message: 'Failed to save drill progress', error: err.message });
  }
};