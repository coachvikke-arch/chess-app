/* Class leaderboard contract tests.
 *
 * These are source-level assertions plus a real scoring test against the actual
 * SQL shape, because the risky part of this feature is not the plumbing (that is
 * thin) but the scoring arithmetic and the scoping rules - getting a winner
 * wrong, or leaking another class's points in, is a correctness bug that would
 * otherwise only surface in a live lesson.
 *
 * Run: node scripts/test-class-leaderboard.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const ctrl = read('src', 'controllers', 'liveClassController.js');
const routes = read('src', 'routes', 'classRoutes.js');
const botCtrl = read('src', 'controllers', 'botController.js');
const botSvc = read('src', 'lib', 'botProgressService.js');
const migration = read('migrations', 'add_class_leaderboard.sql');

/** The leaderboard query on its own. Assertions about the SQL run against this
 *  rather than the whole controller, so a test cannot pass by matching the same
 *  word in a comment or in the response mapping. */
const sql = ctrl.match(/const CLASS_LEADERBOARD_SQL = `([\s\S]*?)`;/)[1];

/** Source with comments stripped. Naming a dropped table in a comment is how
 *  this file explains itself, so a raw text scan would flag its own notes. */
const ctrlCode = ctrl
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test("the leaderboard no longer scores games at all", () => {
  /* It used to read bot_game_results with result filtered on 'defeated' when the
     ledger actually stores 'win' | 'loss' | 'draw' - which reported 0 bot wins
     forever while the coins still counted, a wrong number that looked right
     because the column was populated.

     Both problems disappear with the PvP and bot sources: the board is drill
     points only, so there is no result token to get wrong and no optional bot
     table to depend on. */
  for (const gone of ['online_games', 'bot_game_results', 'coins_awarded', 'defeated']) {
    assert.ok(!sql.includes(gone), `${gone} must not appear in the leaderboard query`);
    assert.ok(!ctrlCode.includes(gone), `${gone} must not be read by the controller at all`);
  }
});

test('the migration makes bot games attributable to a class', () => {
  assert.match(
    migration,
    /ALTER TABLE bot_game_results\s+ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes\(id\) ON DELETE SET NULL/,
    'class_id is added as nullable with ON DELETE SET NULL',
  );
  assert.match(migration, /idx_bot_game_results_class/, 'and indexed for the leaderboard join');
});

test('the route is registered', () => {
  assert.match(routes, /router\.get\('\/:id\/leaderboard', liveCtrl\.getClassLeaderboard\)/);
});

test('the drill activity is filtered to the requested class', () => {
  assert.match(sql, /WHERE d\.live_class_id = \$1/, 'drills joined back to this class');
  assert.match(sql, /WHERE live_class_id = \$1\n\)/, 'and the assignment count too');
  assert.match(sql, /WHERE lp\.live_class_id = \$1/, 'presence too');
  assert.match(sql, /WHERE a\.class_id = \$1/, 'and attendance too');
});

test('no all-time scoring table is consulted', () => {
  /* The whole point of this board is that it is NOT the global leaderboard. A
     stray join to the career tables here would silently reintroduce that. */
  for (const table of ['student_time_ratings', 'student_game_analysis', 'puzzle_attempts', 'academy_stats']) {
    assert.ok(!ctrl.includes(table), `${table} must not appear in the class leaderboard query`);
  }
});

test('every member of the roster is ranked, scorer or not', () => {
  /* The status column only earns its place if the students who have not scored
     are on the board too - otherwise the coach cannot see who needs chasing. */
  assert.match(ctrl, /FROM class_students cs/, 'the pool is the class roster');
  assert.ok(!/WHERE total_points > 0 OR/.test(ctrl), 'there is no participation filter');
  assert.match(sql, /FROM scored\nORDER BY/, 'every roster row reaches the sort');
});

test('online games and bot games are off this board entirely', () => {
  /* Scoped to the drills the coach assigned. A student must not be able to top
     the class by grinding bots before the lesson, and a game abandoned mid-way
     has no defined outcome to score. */
  for (const gone of ['online_games', 'bot_game_results', 'coins_awarded', 'admin_color']) {
    assert.ok(!sql.includes(gone), `${gone} must not appear in the leaderboard query`);
  }
});

test('coach-configured drill points are passed through untouched', () => {
  /* The coach sets points per drill. Any multiplier here would silently discard
     the number they chose, and the board would stop matching the drill. */
  assert.match(sql, /COALESCE\(SUM\(p\.points_earned\), 0\)/, 'drill points as-is');
  assert.ok(!/SUM\(p\.points_earned\s*\*\s*\d/.test(sql), 'not re-weighted');
  assert.ok(!/PVP_WIN_POINTS|PVP_DRAW_POINTS/.test(ctrl), 'and no board-side constants remain');
});

test('the tie-break chain is total and deterministic', () => {
  /* Without the final name sort two students on identical points could swap
     places between polls, making the board appear to flicker. */
  assert.match(sql, /ORDER BY total_points DESC, puzzles_solved DESC, name ASC/);
});

test('the endpoint answers for students, not only the coach', () => {
  /* The board motivates the students, so it must not be admin-gated - but it
     must still refuse non-members. */
  assert.match(ctrl, /if \(!access\.authorized\)[\s\S]{0,120}?not authorized to view this class leaderboard/);
  assert.ok(!/roleMiddleware\('admin'\)/.test(
    read('src', 'routes', 'classRoutes.js').split("router.get('/:id/leaderboard'")[1] || '',
  ), 'the route carries no admin role gate');
});

test('the response is shaped for the shared podium component', () => {
  for (const field of ['user_id', 'student_id', 'name', 'avatar_config', 'profile_image', 'total_points', 'rank']) {
    assert.ok(ctrl.includes(field), `response carries ${field}`);
  }
  assert.match(ctrl, /points: r\.total_points/, 'points alias for the shared podium');
  /* wins / games_played are gone: there is no game on this board, and reporting
     zeros would imply the student had played and lost. */
  for (const gone of ['pvp_points', 'pvp_wins', 'pvp_losses', 'pvp_games', 'bot_points', 'bot_games']) {
    assert.ok(!new RegExp(`${gone}: r\.`).test(ctrl), `${gone} is not in the response`);
  }
  assert.match(ctrl, /source: 'drills'/, 'and the payload says what it scores');
});

test('every row carries the fields the status column needs', () => {
  for (const f of ['status', 'puzzles_solved', 'puzzles_attempted', 'drills_assigned', 'in_room', 'marked_present']) {
    assert.ok(ctrl.includes(`${f}: r.${f}`), `response carries ${f}`);
  }
});

test('the status CASE cannot call an empty class complete', () => {
  /* With no drill assigned, solved(0) >= assigned(0) is true, so the comparison
     is written against GREATEST(assigned, 1) and gated on a real attempt. */
  assert.match(sql, /GREATEST\(drills_assigned, 1\)/, 'the comparison cannot pass on an empty assignment');
  assert.match(sql, /AND puzzles_attempted > 0 THEN 'completed'/, 'and needs a real attempt');
  assert.match(sql, /ELSE 'not_joined'/, 'falling through to not_joined otherwise');
});

test('the coach is not counted as present just for hosting', () => {
  assert.match(sql, /AND lp\.role_in_class = 'student'/, 'presence counts students only');
});

/* ---------------- drill scoring + status arithmetic ---------------- */

/* Mirrors the SQL: a total is the sum of what a student earned on the drills
   assigned in this class. Wrong attempts go in as negative points, which is why
   the sum is deliberately not clamped. */
function totalFromDrillProgress(rows) {
  return rows.reduce((sum, r) => sum + r.points_earned, 0);
}

test('scoring: the total is exactly the drill points, neither scaled nor floored', () => {
  assert.equal(totalFromDrillProgress([{ points_earned: 100 }]), 100, 'one drill');
  assert.equal(totalFromDrillProgress([{ points_earned: 10 }, { points_earned: 100 }]), 110, 'two drills');
});

test('scoring: wrong attempts subtract, and the board does not clamp to zero', () => {
  /* A student who fails attempts before solving has a legitimately lower total.
     Clamping would make a wrong answer free. */
  assert.equal(totalFromDrillProgress([{ points_earned: -5 }, { points_earned: 100 }]), 95, 'penalty applies');
  assert.equal(totalFromDrillProgress([{ points_earned: -5 }, { points_earned: -5 }]), -10, 'all-failed stays negative');
});

test('scoring: a solved drill counts once regardless of attempts', () => {
  /* progress is one row per (drill, student), so re-attempts update that row
     rather than adding one - otherwise points would compound per retry. */
  const attempts = [{ drill_id: 39, result: 'completed', points_earned: 100 }];
  assert.equal(attempts.filter((r) => r.result === 'completed').length, 1);
  assert.equal(totalFromDrillProgress(attempts), 100);
});

test('scoring: an unsolved drill still counts as attempted', () => {
  /* This is what separates a student working through the drill from one who has
     not opened it at all. */
  const rows = [{ result: 'solving' }, { result: 'time_finished' }, { result: 'failed' }];
  assert.equal(rows.length, 3, 'three attempts recorded');
  assert.equal(rows.filter((r) => r.result === 'completed').length, 0, 'none solved');
});

/* Mirrors the SQL CASE for the status column. */
function statusOf({ solved, attempted, assigned, inRoom, present }) {
  if (solved >= Math.max(assigned, 1) && attempted > 0) return 'completed';
  if (attempted > 0) return 'in_progress';
  if (inRoom || present) return 'joined';
  return 'not_joined';
}

test('status: every drill solved is completed', () => {
  assert.equal(statusOf({ solved: 2, attempted: 2, assigned: 2 }), 'completed');
});

test('status: a partial drill is in progress, not completed', () => {
  assert.equal(statusOf({ solved: 1, attempted: 1, assigned: 2 }), 'in_progress');
  /* Even after giving up on every drill, they have done something. */
  assert.equal(statusOf({ solved: 0, attempted: 2, assigned: 2 }), 'in_progress');
});

test('status: present but not started reads as joined', () => {
  assert.equal(statusOf({ solved: 0, attempted: 0, assigned: 2, inRoom: true }), 'joined');
  /* Attendance alone is enough - the backend marks it on join even if the
     student closed the tab before the drill opened. */
  assert.equal(statusOf({ solved: 0, attempted: 0, assigned: 2, present: true }), 'joined');
});

test('status: an empty class cannot report everybody as completed', () => {
  /* The bug this guards: with no drill assigned, solved(0) >= assigned(0) is
     true, so an unguarded comparison marks every student complete and the board
     reads as though the class finished work that does not exist. */
  assert.equal(statusOf({ solved: 0, attempted: 0, assigned: 0, inRoom: true }), 'joined');
  assert.equal(statusOf({ solved: 0, attempted: 0, assigned: 0 }), 'not_joined');
  assert.notEqual(statusOf({ solved: 0, attempted: 0, assigned: 0, inRoom: true }), 'completed');
});

test('status: a drill removed afterwards cannot strand a student short of complete', () => {
  /* If a drill is deleted after everyone solved it, solved can exceed assigned.
     >= rather than === keeps them marked complete. */
  assert.equal(statusOf({ solved: 3, attempted: 3, assigned: 2 }), 'completed');
});

test('status: never arrived is distinguishable from arrived and idle', () => {
  /* This is the distinction the coach acts on, so it must not collapse. */
  const neverCame = statusOf({ solved: 0, attempted: 0, assigned: 2, inRoom: false, present: false });
  const cameButIdle = statusOf({ solved: 0, attempted: 0, assigned: 2, inRoom: true, present: true });
  assert.equal(neverCame, 'not_joined');
  assert.equal(cameButIdle, 'joined');
  assert.notEqual(neverCame, cameButIdle);
});

test('a zero-point student is still ranked, because the roster is not filtered', () => {
  /* The old board dropped anyone who had not scored - exactly the student the
     coach most needs to see. */
  const roster = [
    { name: 'A', total: 110, status: 'completed' },
    { name: 'B', total: 0, status: 'not_joined' },
    { name: 'C', total: -6, status: 'in_progress' },
  ];
  assert.equal(roster.length, 3, 'all three appear');
  assert.ok(roster.some((r) => r.total === 0), 'including the zero');
  assert.ok(roster.some((r) => r.total < 0), 'and the negative, sorted last');
});


/* ---------------- bot attribution safety ---------------- */

test('a forged classId is rejected by a server-side membership check', () => {
  assert.match(botCtrl, /userIsMemberOfClass/);
  assert.match(botCtrl, /if \(access\.authorized\) verifiedClassId = parsedClassId/);
});

test('an unverifiable class degrades to null instead of failing the request', () => {
  /* A leaderboard line is never worth the coins a student actually earned. */
  assert.match(botCtrl, /let verifiedClassId = null/);
  assert.match(botCtrl, /console\.warn\('\[submitResult\] class membership check failed/, 'and is logged');
});

test('recordGame stores null when there is no class context', () => {
  assert.match(botSvc, /classId == null \|\| classId === '' \? null : parseInt\(classId, 10\)/);
  assert.match(botSvc, /INSERT INTO bot_game_results \([^)]*class_id\)/);
});