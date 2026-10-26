/* Coach-assigned puzzle sync contract tests.
 *
 * The reported bug: a student with 4 coach assignments saw only 2 puzzle
 * folders, with progress/status/buttons suspected of mixing assignments that
 * share a title or a puzzle folder. The canonical record is one
 * `assignment_submissions` row per (assignment, student) — keyed by assignment
 * ID, never by title or folder — and every read/credit/submit path must honor
 * exactly that row.
 *
 * What this file proves (read-only against the live DB, plus source
 * contracts — no writes, no fixtures, nothing deleted):
 *   1. one student assignment card per submission row (same titles stay separate,
 *      shared folders stay separate);
 *   2. progress is derived per assignment from its own linked attempts
 *      (uniquePuzzlesSolved / totalAssignedPuzzles, never mixed);
 *   3. submitted assignments stay listed (never dropped for being submitted);
 *   4. no corrupt "submitted with NULL score" rows survive (repair migration);
 *   5. attempts credit the exact assignment being worked (targeted link), the
 *      handed-in check is scoped to it, assigning is duplicate-safe, and
 *      submitting touches only its own submission row idempotently.
 *
 * Run: node --test scripts/test-puzzle-assignment-sync.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../src/config/database');
const puzzleCtrl = require('../src/controllers/puzzleController');
const assignCtrl = require('../src/controllers/assignmentController');

const puzzleSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'controllers', 'puzzleController.js'), 'utf8'
);
const assignSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'controllers', 'assignmentController.js'), 'utf8'
);
const puzzlesPage = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'Puzzles.jsx'), 'utf8'
);

function stubRes(capture) {
  return {
    json: (data) => { capture.body = data; return capture; },
    status: (code) => { capture.status = code; return { json: (data) => { capture.body = data; return capture; } }; },
  };
}

async function callList(studentUserId) {
  const capture = {};
  await puzzleCtrl.listStudentPuzzleAssignments({ user: { id: studentUserId } }, stubRes(capture));
  assert.ok(capture.body && Array.isArray(capture.body.assignments), 'expected { assignments: [] }');
  return capture.body.assignments;
}

test('every submission row surfaces as its own card (titles/folders never merge)', async () => {
  const students = await db.query(
    `SELECT DISTINCT s.id AS student_id, s.user_id
     FROM assignment_submissions sub
     JOIN students s ON s.id = sub.student_id
     JOIN assignments a ON a.id = sub.assignment_id
     WHERE a.type = 'puzzle_assignment' AND s.user_id IS NOT NULL`
  );
  assert.ok(students.rows.length > 0, 'needs at least one assigned student to prove anything');
  for (const { student_id, user_id } of students.rows) {
    const cards = await callList(user_id);
    const subCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM assignment_submissions sub
       JOIN assignments a ON a.id = sub.assignment_id
       WHERE sub.student_id = $1 AND a.type = 'puzzle_assignment'`,
      [student_id]
    );
    assert.equal(cards.length, subCount.rows[0].n, `student ${student_id}: cards must equal submission rows`);
    assert.equal(new Set(cards.map((c) => c.assignmentId)).size, cards.length, 'cards keyed by unique assignment id');
    for (const c of cards) {
      assert.ok(Number.isInteger(c.assignmentId), 'card carries its assignment id');
      assert.ok(Number.isInteger(c.submissionId), 'card carries its submission id');
    }
  }
});

test('same-title and shared-folder assignments stay independent with own progress', async () => {
  const students = await db.query(
    `SELECT DISTINCT s.user_id FROM assignment_submissions sub
     JOIN students s ON s.id = sub.student_id
     JOIN assignments a ON a.id = sub.assignment_id
     WHERE a.type = 'puzzle_assignment' AND s.user_id IS NOT NULL`
  );
  for (const { user_id } of students.rows) {
    const cards = await callList(user_id);
    for (const c of cards) {
      const { solved, total, pct } = c.progress;
      assert.equal(pct, total > 0 ? Math.round((solved / total) * 100) : 0, `assignment ${c.assignmentId}: pct matches own solved/total`);
      assert.ok(solved <= total, `assignment ${c.assignmentId}: solved never exceeds its own membership`);
      assert.equal(total, c.puzzles.length, `assignment ${c.assignmentId}: total matches its own puzzle list`);
      const solvedIds = c.puzzles.filter((p) => p.attemptResult === 'correct').map((p) => p.id);
      assert.equal(new Set(solvedIds).size, solved, `assignment ${c.assignmentId}: no puzzle counted twice`);
    }
    // Same title twice (or the same folder twice) must still be two cards.
    const byTitle = {};
    for (const c of cards) (byTitle[c.title] ||= []).push(c);
    for (const [title, group] of Object.entries(byTitle)) {
      if (group.length > 1) {
        assert.equal(new Set(group.map((c) => c.assignmentId)).size, group.length, `"${title}": identical titles remain separate`);
      }
    }
  }
});

test('link-scoped credit: a card counts only attempts linked to its own assignment', async () => {
  const r = await db.query(
    `SELECT sub.student_id, sub.assignment_id,
            (SELECT COUNT(DISTINCT pa.puzzle_id)::int FROM puzzle_attempts pa
             WHERE pa.student_id = sub.student_id
               AND pa.puzzle_assignment_id = sub.assignment_id
               AND pa.result = 'correct') AS linked_solved
     FROM assignment_submissions sub
     JOIN assignments a ON a.id = sub.assignment_id
     WHERE a.type = 'puzzle_assignment'
     LIMIT 50`
  );
  const byStudent = {};
  for (const row of r.rows) (byStudent[row.student_id] ||= []).push(row);
  for (const [studentId, rows] of Object.entries(byStudent)) {
    const userRes = await db.query('SELECT user_id FROM students WHERE id = $1', [Number(studentId)]);
    if (!userRes.rows[0]?.user_id) continue;
    const cards = await callList(userRes.rows[0].user_id);
    for (const row of rows) {
      const card = cards.find((c) => c.assignmentId === row.assignment_id);
      assert.ok(card, `assignment ${row.assignment_id} listed`);
      assert.equal(card.progress.solved, row.linked_solved, `assignment ${row.assignment_id}: solved counts only its own linked attempts`);
    }
  }
});

test('submitted assignments remain listed (never dropped for being submitted)', async () => {
  const r = await db.query(
    `SELECT s.user_id, sub.assignment_id FROM assignment_submissions sub
     JOIN students s ON s.id = sub.student_id
     JOIN assignments a ON a.id = sub.assignment_id
     WHERE a.type = 'puzzle_assignment' AND sub.status IN ('submitted', 'reviewed')
       AND s.user_id IS NOT NULL LIMIT 5`
  );
  for (const row of r.rows) {
    const cards = await callList(row.user_id);
    assert.ok(cards.some((c) => c.assignmentId === row.assignment_id), `submitted assignment ${row.assignment_id} still listed`);
  }
});

test('no corrupt submitted rows survive (repair migration invariant)', async () => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM assignment_submissions sub
     WHERE sub.status = 'submitted' AND sub.reviewed_at IS NULL
       AND sub.score IS NULL AND sub.submitted_at IS NOT NULL
       AND sub.assignment_id IN (SELECT id FROM assignments WHERE type = 'puzzle_assignment')`
  );
  assert.equal(r.rows[0].n, 0, 'a stored submitted without a score is never a real hand-in');
});

test('attempts credit the exact assignment being worked (targeted link)', () => {
  assert.match(puzzleSrc, /req\.body\?\.assignmentId/, 'attempt reads the assignment being worked from the request');
  assert.match(
    puzzleSrc,
    /WHERE sub\.student_id = \$1 AND sub\.assignment_id = \$2 AND ap\.puzzle_id = \$3/,
    'targeted link is validated: puzzle in that assignment AND assigned to this student'
  );
  assert.match(
    puzzleSrc,
    /wantsTargeted\s*\?\s*\{\s*rows:\s*\[\{\s*assignment_id:\s*requestedAssignmentId\s*\}\]/,
    'a validated targeted assignment wins the attempt link (no guessing)'
  );
});

test('the handed-in block is scoped to the assignment being worked', () => {
  assert.match(
    puzzleSrc,
    /wantsTargeted\s*\?\s*\{\s*rows:\s*\[\]\s*\}/,
    'targeted solves skip the cross-assignment submitted check'
  );
  assert.match(
    puzzleSrc,
    /handing[\s/]*in assignment A must never lock the same puzzle inside the still-open[\s/]*assignment B/,
    'the scoping rule is documented at the check'
  );
});

test('assigning is duplicate-safe and keyed by (assignment, student)', async () => {
  assert.match(assignSrc, /ON CONFLICT \(assignment_id, student_id\) DO NOTHING/, 're-assign never duplicates the submission row');
  const r = await db.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'assignment_submissions'::regclass
       AND pg_get_constraintdef(oid) = 'UNIQUE (assignment_id, student_id)'`
  );
  assert.ok(r.rows.length > 0, 'UNIQUE (assignment_id, student_id) enforced in the database');
  // A retry of the same composition cannot plant the same puzzle twice in one
  // assignment: the membership table carries its own uniqueness. (Sharing one
  // puzzle across DIFFERENT assignments is legal — that is the folder-reuse
  // the sync must tolerate — so this lives in the database, not as an
  // ON CONFLICT in the create path, where every POST mints a new assignment.)
  const mem = await db.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'assignment_puzzles'::regclass
       AND pg_get_constraintdef(oid) = 'UNIQUE (assignment_id, puzzle_id)'`
  );
  assert.ok(mem.rows.length > 0, 'UNIQUE (assignment_id, puzzle_id) enforced in the database');
});

test('submitting touches only its own submission row, idempotently', () => {
  assert.match(puzzleSrc, /WHERE sub\.student_id = \$1 AND sub\.assignment_id = \$2/, 'submit verifies the assignment belongs to the current student');
  assert.match(puzzleSrc, /WHERE id = \$3\s*\n?\s*RETURNING \*/, 'submit updates by its own submission id');
  assert.match(puzzleSrc, /alreadySubmitted/, 'double submit reports the existing hand-in instead of duplicating');
});

test('each card submits/continues by its own assignment id', () => {
  assert.match(puzzlesPage, /api\.post\(`\/puzzles\/\$\{assignment\.assignmentId\}\/submit-assignment`\)/, 'Submit Assignment posts the card assignment id');
  assert.match(puzzlesPage, /assignmentId: activeAssignment\?\.assignmentId \?\? null/, 'solving sends the open assignment id with every attempt');
  assert.match(puzzlesPage, /key=\{a\.assignmentId\}/, 'cards keyed by assignment id, never by title');
});
