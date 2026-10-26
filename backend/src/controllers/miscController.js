const db = require('../config/database');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ─── Python analysis runner ──────────────────────────────────────────────
 * Spawns the python chess-analysis helper (backend/vision/game_analysis.py)
 * and returns its stdout JSON. Gracefully degrades if python is unavailable
 * or the script crashes — the rest of the app remains fully functional.
 * A bounded semaphore caps how many analysis processes may run at once (each
 * is its own python interpreter); extra requests wait for a free slot. */
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'vision', 'game_analysis.py');

const MAX_PYTHON_ANALYSIS =
  Math.max(1, Number(process.env.MAX_PYTHON_ANALYSIS) || Math.max(1, Math.min((os.cpus().length || 2) - 1, 4)));
let pythonActive = 0;
const pythonWaiters = [];

function acquirePythonSlot() {
  return new Promise((resolve) => {
    if (pythonActive < MAX_PYTHON_ANALYSIS) { pythonActive += 1; resolve(); return; }
    pythonWaiters.push(resolve);
  });
}

function releasePythonSlot() {
  const next = pythonWaiters.shift();
  if (next) { next(); return; }
  pythonActive -= 1;
}

async function runPythonAnalysis(args) {
  await acquirePythonSlot();
  try {
    return await runPythonAnalysisRaw(args);
  } finally {
    releasePythonSlot();
  }
}

function runPythonAnalysisRaw(args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    try {
      const proc = spawn(PYTHON_BIN, [SCRIPT_PATH, ...args], {
        cwd: path.dirname(SCRIPT_PATH),
        timeout: 60_000,
      });
      proc.stdout.on('data', (d) => { stdout += String(d); });
      proc.stderr.on('data', (d) => { stderr += String(d); });
      proc.on('error', (err) => {
        resolve({ ok: false, error: `python spawn failed: ${err.message}` });
      });
      proc.on('close', (code) => {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && typeof parsed === 'object') resolve(parsed);
          else throw new Error('not-json');
        } catch {
          resolve({
            ok: false,
            error: `analysis script failed (exit ${code})`,
            _stderr: stderr.slice(0, 400),
            _stdout: stdout.slice(0, 400),
          });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: `analysis setup failed: ${e.message}` });
    }
  });
}

// Groups
exports.listGroups = async (req, res) => {
  const result = await db.query(
    `SELECT g.id, g.name, g.description, g.coach_id, g.created_at,
            cu.name AS coach_name,
            COUNT(s.id)::int AS student_count
     FROM groups g
     LEFT JOIN users cu ON cu.id = g.coach_id
     LEFT JOIN students s ON s.group_id = g.id
     GROUP BY g.id, cu.name
     ORDER BY g.name`
  );
  res.json(result.rows);
};
exports.createGroup = async (req, res) => {
  const { name, description } = req.body;
  const result = await db.query(
    'INSERT INTO groups (name, description, coach_id) VALUES ($1,$2,$3) RETURNING *',
    [name, description, req.user.id]
  );
  res.status(201).json(result.rows[0]);
};
exports.assignStudentToGroup = async (req, res) => {
  const { studentId, groupId } = req.body;
  await db.query('UPDATE students SET group_id = $1 WHERE id = $2', [groupId, studentId]);
  res.json({ message: 'Student assigned to group' });
};
exports.updateGroup = async (req, res) => {
  const { name, description, coachId } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined) { params.push(name); updates.push(`name = $${params.length}`); }
  if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
  if (coachId !== undefined) { params.push(coachId || null); updates.push(`coach_id = $${params.length}`); }
  if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });
  params.push(req.params.id);
  const result = await db.query(
    `UPDATE groups SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
  res.json(result.rows[0]);
};
exports.deleteGroup = async (req, res) => {
  const result = await db.query('DELETE FROM groups WHERE id = $1 RETURNING *', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
  res.json({ message: 'Batch deleted' });
};

// Announcements
exports.listAnnouncements = async (req, res) => {
  const result = await db.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20');
  res.json(result.rows);
};
exports.createAnnouncement = async (req, res) => {
  const { title, message } = req.body;
  const result = await db.query(
    'INSERT INTO announcements (title, message, coach_id) VALUES ($1,$2,$3) RETURNING *',
    [title, message, req.user.id]
  );
  res.status(201).json(result.rows[0]);
};
exports.deleteAnnouncement = async (req, res) => {
  const result = await db.query('DELETE FROM announcements WHERE id = $1 RETURNING *', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ message: 'Announcement not found.' });
  res.json({ message: 'Announcement deleted.' });
};

// Notifications
exports.listNotifications = async (req, res) => {
  try {
    const { sendMeetingReminders } = require('./classController');
    try { await sendMeetingReminders(30); } catch (e) { /* non-fatal */ }
    const result = await db.query(
      `SELECT n.*, u.name AS sender_name, u.profile_image AS sender_avatar, u.avatar_config AS sender_avatar_config
       FROM notifications n
       LEFT JOIN users u ON u.id = n.sender_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
  }
};
exports.markNotificationRead = async (req, res) => {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ message: 'Marked as read' });
};

exports.unreadNotificationsCount = async (req, res) => {
  try {
    const { sendMeetingReminders } = require('./classController');
    try { await sendMeetingReminders(30); } catch (e) { /* non-fatal */ }
    const result = await db.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch unread count', error: err.message });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
};

exports.clearNotifications = async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All notifications cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to clear notifications', error: err.message });
  }
};

// Achievements
exports.listAchievements = async (req, res) => {
  const result = await db.query('SELECT * FROM achievements ORDER BY id');
  res.json(result.rows);
};
exports.studentAchievements = async (req, res) => {
  const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
  const studentId = studentRes.rows[0]?.id;
  if (!studentId) return res.json([]);
  const result = await db.query(
    `SELECT a.* FROM student_achievements sa JOIN achievements a ON a.id = sa.achievement_id WHERE sa.student_id = $1`,
    [studentId]
  );
  res.json(result.rows);
};

// Game analysis
exports.analyzeGame = async (req, res) => {
  try {
    const { pgn, fen, imagePath, skill } = req.body || {};
    const args = [];
    if (skill) args.push('--skill', String(skill));
    if (imagePath) args.push('--image', String(imagePath));
    else if (fen) args.push('--fen', String(fen));
    else if (pgn) args.push('--pgn', String(pgn));
    else {
      return res.status(400).json({ message: 'One of pgn, fen, or imagePath is required' });
    }
    const analysis = await runPythonAnalysis(args);
    res.json({
      ok: !!analysis.ok,
      analysis,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('analyzeGame error:', err);
    res.status(500).json({ message: 'Analysis failed', error: err.message });
  }
};

exports.submitGame = async (req, res) => {
  try {
    const { pgn, fen, runPython = false, skill } = req.body;
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    let pythonAnalysis = null;
    if (runPython) {
      try {
        const args = [];
        if (skill) args.push('--skill', String(skill));
        if (pgn) args.push('--pgn', String(pgn));
        else if (fen) args.push('--fen', String(fen));
        pythonAnalysis = args.length
          ? await runPythonAnalysis(args)
          : null;
      } catch (e) {
        // Non-fatal: DB save still succeeds even if python analysis fails.
        pythonAnalysis = { ok: false, error: e.message };
      }
    }

    const storedAnalysis = pythonAnalysis ? JSON.stringify(pythonAnalysis) : null;
    const result = await db.query(
      `INSERT INTO game_analysis (student_id, pgn, fen, coach_feedback)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [studentId, pgn, fen, storedAnalysis]
    );
    res.status(201).json({
      ...result.rows[0],
      analysis: pythonAnalysis,
    });
  } catch (err) {
    console.error('submitGame error:', err);
    res.status(500).json({ message: 'Failed to submit game', error: err.message });
  }
};

exports.listGameAnalyses = async (req, res) => {
  const result = await db.query(
    `SELECT ga.*, u.name AS student_name FROM game_analysis ga
     JOIN students s ON s.id = ga.student_id JOIN users u ON u.id = s.user_id
     ORDER BY ga.created_at DESC LIMIT 50`
  );
  res.json(result.rows);
};

exports.giveGameFeedback = async (req, res) => {
  const { feedback } = req.body;
  const result = await db.query(
    'UPDATE game_analysis SET coach_feedback = $1, coach_id = $2 WHERE id = $3 RETURNING *',
    [feedback, req.user.id, req.params.id]
  );
  res.json(result.rows[0]);
};

/* ─── Admin worklist: assignments + puzzles grouped by class ──────────────────
   For every class it returns the assigned student roster plus the work items
   that reach those students:
     - Assignments are platform-wide; each one shows every roster student with
       their submission status (submitted / pending) and score.
     - Puzzles are per-student (`student_puzzle_assignments`); each puzzle shows
       only the students who were actually assigned it, with status/points. */
exports.worklist = async (req, res) => {
  try {
    const [
      classesRes,
      studentsRes,
      csRes,
      assignmentsRes,
      submissionsRes,
      spaRes,
      puzzleRes,
    ] = await Promise.all([
      db.query(
        `SELECT cl.id, cl.title, cl.class_date, cl.start_time, cl.status, cl.class_type, cl.group_id,
                g.name AS group_name
         FROM classes cl
         LEFT JOIN groups g ON g.id = cl.group_id
         ORDER BY cl.class_date DESC, cl.start_time DESC`
      ),
      db.query(
        `SELECT s.id, u.name AS name, s.group_id
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE s.active = TRUE
         ORDER BY u.name`
      ),
      db.query(`SELECT class_id, student_id FROM class_students`),
      db.query(
        `SELECT a.id, a.title, a.description, a.due_date, a.difficulty, c.title AS course_title
         FROM assignments a
         LEFT JOIN courses c ON c.id = a.course_id
         ORDER BY a.due_date ASC NULLS LAST`
      ),
      db.query(
        `SELECT sub.assignment_id, sub.student_id, sub.score, sub.approved
         FROM assignment_submissions sub`
      ),
      db.query(
        `SELECT spa.student_id, spa.puzzle_id, spa.status, spa.due_date, spa.notes,
                spa.points, spa.max_attempts
         FROM student_puzzle_assignments spa`
      ),
      db.query(`SELECT id, theme, difficulty FROM puzzles`),
    ]);

    const studentMeta = new Map(studentsRes.rows.map((r) => [r.id, r]));
    const groupMembers = {};
    const allStudentIds = new Set();
    for (const r of studentsRes.rows) {
      allStudentIds.add(r.id);
      if (r.group_id != null) (groupMembers[r.group_id] = groupMembers[r.group_id] || new Set()).add(r.id);
    }
    const explicitMembers = {};
    for (const r of csRes.rows) {
      (explicitMembers[r.class_id] = explicitMembers[r.class_id] || new Set()).add(r.student_id);
    }

    // roster = explicit class_students, else the class group, else everyone
    const classes = classesRes.rows.map((c) => {
      const explicit = explicitMembers[c.id];
      const roster = explicit && explicit.size > 0
        ? explicit
        : c.group_id != null
          ? groupMembers[c.group_id] || new Set()
          : allStudentIds;
      return {
        id: c.id,
        title: c.title,
        classDate: c.class_date,
        startTime: c.start_time,
        status: c.status,
        classType: c.class_type,
        groupName: c.group_name || null,
        students: [...roster]
          .map((sid) => studentMeta.get(sid))
          .filter(Boolean)
          .map((s) => ({ studentId: s.id, name: s.name })),
      };
    });

    // assignments → per (assignment, student) submission lookup
    const subByAssignment = {};
    for (const r of submissionsRes.rows) {
      (subByAssignment[r.assignment_id] = subByAssignment[r.assignment_id] || {})[r.student_id] = r;
    }
    const assignmentsRows = assignmentsRes.rows;

    // puzzles → per (puzzle, student) assignment lookup + puzzle meta
    const spaByPuzzle = {};
    for (const r of spaRes.rows) {
      (spaByPuzzle[r.puzzle_id] = spaByPuzzle[r.puzzle_id] || {})[r.student_id] = r;
    }
    const puzzleMeta = new Map(puzzleRes.rows.map((r) => [r.id, r]));

    const result = classes.map((c) => {
      const rosterIds = new Set(c.students.map((s) => s.studentId));

      const assignments = assignmentsRows.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        dueDate: a.due_date,
        difficulty: a.difficulty,
        courseTitle: a.course_title,
        students: c.students.map((s) => {
          const sub = (subByAssignment[a.id] || {})[s.studentId];
          return {
            studentId: s.studentId,
            name: s.name,
            status: sub ? 'submitted' : 'pending',
            score: sub && sub.score != null ? sub.score : null,
            approved: sub ? !!sub.approved : false,
          };
        }),
      }));

      const puzzles = Object.keys(spaByPuzzle)
        .map((puzzleId) => Number(puzzleId))
        .filter((puzzleId) => Object.keys(spaByPuzzle[puzzleId]).some((sid) => rosterIds.has(Number(sid))))
        .map((puzzleId) => {
          const meta = puzzleMeta.get(puzzleId) || {};
          const rows = Object.keys(spaByPuzzle[puzzleId])
            .map((sid) => Number(sid))
            .filter((sid) => rosterIds.has(sid))
            .map((sid) => {
              const spa = spaByPuzzle[puzzleId][sid];
              return {
                studentId: sid,
                name: (studentMeta.get(sid) || {}).name || 'Student',
                status: spa.status,
                dueDate: spa.due_date,
                points: spa.points,
                maxAttempts: spa.max_attempts,
              };
            })
            .sort((x, y) => x.name.localeCompare(y.name));
          return {
            id: puzzleId,
            theme: meta.theme || 'Tactics',
            difficulty: meta.difficulty || 'Medium',
            students: rows,
          };
        })
        .sort((a, b) => (a.theme || '').localeCompare(b.theme || ''));

      return { ...c, assignments, puzzles };
    });

    res.json({ classes: result });
  } catch (err) {
    res.status(500).json({ message: 'Failed to build worklist', error: err.message });
  }
};

/* ── GET /api/worklist/puzzles ─────────────────────────────────────
   Puzzle-folder view for the admin worklist: every SET that has at least one
   assigned puzzle, with each puzzle's assigned students (name plus the list of
   class(es) they belong to per the roster rule) and assignment meta. The
   frontend renders this through the same folder tree as the puzzle section.
   ── Roster rule ──: explicit `class_students` → else the class's `group_id`
   members → else all active students. A student can sit in several classes. */
exports.worklistPuzzles = async (req, res) => {
  try {
    const [classesRes, studentsRes, csRes, spaRes, puzzleRes, setsRes] = await Promise.all([
      db.query(
        `SELECT cl.id, cl.title, cl.group_id
         FROM classes cl
         ORDER BY cl.class_date DESC, cl.start_time DESC`
      ),
      db.query(
        `SELECT s.id, u.name AS name, s.group_id
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE s.active = TRUE
         ORDER BY u.name`
      ),
      db.query(`SELECT class_id, student_id FROM class_students`),
      db.query(
        `SELECT spa.student_id, spa.puzzle_id, spa.status, spa.due_date, spa.points, spa.max_attempts
         FROM student_puzzle_assignments spa`
      ),
      db.query(`SELECT id, set_code, theme, difficulty, title, order_index FROM puzzles`),
      db.query(`SELECT code AS set_code, name AS set_name, folder_id FROM sets ORDER BY name ASC, code ASC`),
    ]);

    const studentMeta = new Map(studentsRes.rows.map((r) => [r.id, r]));
    const groupMembers = {};
    const allStudentIds = new Set();
    for (const r of studentsRes.rows) {
      allStudentIds.add(r.id);
      if (r.group_id != null) (groupMembers[r.group_id] = groupMembers[r.group_id] || new Set()).add(r.id);
    }
    const explicitMembers = {};
    for (const r of csRes.rows) {
      (explicitMembers[r.class_id] = explicitMembers[r.class_id] || new Set()).add(r.student_id);
    }

    const classRosters = new Map();
    for (const c of classesRes.rows) {
      const explicit = explicitMembers[c.id];
      const roster = explicit && explicit.size > 0
        ? explicit
        : c.group_id != null
          ? groupMembers[c.group_id] || new Set()
          : allStudentIds;
      classRosters.set(c.id, roster);
    }

    // studentId -> sorted list of class titles it belongs to
    const studentClasses = new Map();
    for (const c of classesRes.rows) {
      for (const sid of classRosters.get(c.id)) {
        if (!studentClasses.has(sid)) studentClasses.set(sid, []);
        studentClasses.get(sid).push(c.title);
      }
    }
    for (const titles of studentClasses.values()) titles.sort((a, b) => a.localeCompare(b));

    const setByCode = new Map(setsRes.rows.map((r) => [r.set_code, r]));
    const puzzleById = new Map(puzzleRes.rows.map((r) => [r.id, r]));

    // group spa rows: set_code -> Map(puzzleId -> assignment rows)
    const bySet = new Map();
    for (const r of spaRes.rows) {
      const p = puzzleById.get(r.puzzle_id);
      if (!p || !setByCode.has(p.set_code)) continue;
      if (!bySet.has(p.set_code)) bySet.set(p.set_code, new Map());
      const puzzles = bySet.get(p.set_code);
      if (!puzzles.has(p.id)) puzzles.set(p.id, []);
      puzzles.get(p.id).push(r);
    }

    const sets = [...bySet.entries()]
      .map(([setCode, puzzlesMap]) => {
        const meta = setByCode.get(setCode);
        const puzzles = [...puzzlesMap.entries()]
          .map(([puzzleId, rows]) => {
            const p = puzzleById.get(puzzleId) || {};
            const students = rows
              .map((r) => ({
                studentId: r.student_id,
                name: (studentMeta.get(r.student_id) || {}).name || 'Student',
                classes: studentClasses.get(r.student_id) || [],
                status: r.status,
                points: r.points,
                dueDate: r.due_date,
                maxAttempts: r.max_attempts,
              }))
              .sort((x, y) => x.name.localeCompare(y.name));
            return {
              id: puzzleId,
              title: p.title || null,
              seq: p.order_index == null ? null : Number(p.order_index),
              theme: p.theme || 'Tactics',
              difficulty: p.difficulty || 'Medium',
              students,
            };
          })
          .sort((a, b) => (a.theme || '').localeCompare(b.theme || ''));
        return {
          setCode,
          setName: meta.set_name,
          folderId: meta.folder_id,
          assignedCount: puzzles.length,
          puzzles,
        };
      })
      .sort((a, b) => (a.setName || '').localeCompare(b.setName || ''));

    res.json({ sets });
  } catch (err) {
    res.status(500).json({ message: 'Failed to build puzzle worklist', error: err.message });
  }
};
