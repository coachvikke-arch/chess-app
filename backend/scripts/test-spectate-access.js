/* Permission rules for "watch classmates" in a live classroom.

   These are the anti-cheat rules, so they are asserted directly against the
   pure predicate in services/spectateAccess.js — the same function the HTTP
   controller and the socket handler call at request time. On top of that, a
   few source assertions pin the wiring (the gate is actually reached from each
   entry point) so the rules cannot be silently bypassed by editing a handler
   without a test failing.

   Run: node --test scripts/test-spectate-access.js  (npm run test:spectate)
*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isClassInstructor,
  canSpectateClass,
  canSpectateGame,
  canMoveGame,
} = require('../src/services/spectateAccess');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CLASS = { id: 7, coach_id: 500, spectate_enabled: true };
const COACH = { id: 500, role: 'admin' };
const OTHER_COACH = { id: 501, role: 'admin' };
const SUPER = { id: 1, role: 'superadmin' };
const STUDENT = { id: 900, role: 'student' };

test('instructor detection: staff roles and the class coach pass, students do not', () => {
  assert.equal(isClassInstructor(COACH, CLASS), true);
  assert.equal(isClassInstructor(SUPER, CLASS), true);
  assert.equal(isClassInstructor(STUDENT, CLASS), false);
  /* Any admin counts as staff (the platform lets any admin host a class), and
     the class coach passes by id even before their role is considered. */
  assert.equal(isClassInstructor(OTHER_COACH, CLASS), true);
  assert.equal(isClassInstructor({ id: 500, role: 'student' }, CLASS), true);
});

test('a student may NOT watch before finishing their own game', () => {
  const d = canSpectateClass({ viewer: STUDENT, classRow: CLASS, ownGameFinished: false });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'own-game-unfinished');
});

test('a student may watch once their own game finished and the switch is on', () => {
  const d = canSpectateClass({ viewer: STUDENT, classRow: CLASS, ownGameFinished: true });
  assert.equal(d.allowed, true);
  assert.equal(d.instructor, false);
});

test('turning the class switch off blocks students even when finished', () => {
  const d = canSpectateClass({
    viewer: STUDENT,
    classRow: { ...CLASS, spectate_enabled: false },
    ownGameFinished: true,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'disabled');
});

test('turning the switch off never blocks the instructor', () => {
  const d = canSpectateClass({
    viewer: COACH,
    classRow: { ...CLASS, spectate_enabled: false },
    ownGameFinished: false,
  });
  assert.equal(d.allowed, true);
  assert.equal(d.instructor, true);
});

test('a student may not watch a game that belongs to a different class', () => {
  const gameFromOtherClass = { id: 1, class_id: 8, admin_id: 1, student_id: 2 };
  const d = canSpectateGame({
    viewer: STUDENT,
    gameRow: gameFromOtherClass,
    classRow: CLASS,
    ownGameFinished: true,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'wrong-class');
});

test('same-class game follows the class rule', () => {
  const game = { id: 1, class_id: 7, admin_id: 1, student_id: 2 };
  assert.equal(
    canSpectateGame({ viewer: STUDENT, gameRow: game, classRow: CLASS, ownGameFinished: false }).allowed,
    false
  );
  assert.equal(
    canSpectateGame({ viewer: STUDENT, gameRow: game, classRow: CLASS, ownGameFinished: true }).allowed,
    true
  );
});

test('only the two players on a game may move — a spectator may not', () => {
  const game = { id: 1, class_id: 7, admin_id: 111, student_id: 222 };
  assert.equal(canMoveGame({ viewer: { id: 111, role: 'student' }, gameRow: game }), true);
  assert.equal(canMoveGame({ viewer: { id: 222, role: 'student' }, gameRow: game }), true);
  assert.equal(canMoveGame({ viewer: { id: 333, role: 'student' }, gameRow: game }), false);
  assert.equal(canMoveGame({ viewer: { id: 500, role: 'admin' }, gameRow: game }), false);
});

test('wiring: the HTTP detail, the class watch feed and the socket join all reach the gate', () => {
  const online = read('src/controllers/onlineController.js');
  /* watchClassmates gates the class and, crucially, excludes the caller's own
     rows so the feed can never leak their own board back at them. */
  assert.match(online, /exports\.watchClassmates/);
  assert.match(online, /canSpectateGame\(\{/);
  assert.match(online, /canSpectateClass\(\{/);
  assert.match(online, /g\.admin_id <> \$2 AND g\.student_id <> \$2/);

  const sock = read('src/socket/liveClassSocket.js');
  assert.match(sock, /socket\.on\('join-game', async/);
  assert.match(sock, /canSpectateGame\(\{/);
  assert.match(sock, /action_rejected/);

  const routes = read('src/routes/classRoutes.js');
  assert.match(routes, /'\/:id\/watch'/);
  assert.match(routes, /'\/:id\/spectate'/);

  const sql = read('migrations/add_class_spectate_enabled.sql');
  assert.match(sql, /spectate_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
});
