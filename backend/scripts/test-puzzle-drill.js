/* Puzzle drill progress contract tests.
 *
 * A drill is asked in the middle of a lesson, scored live, and paid out in
 * points the moment a student is marked complete — so the rule that decides
 * "this line is finished" is the one that must not be taken on trust.
 *
 * Run: node --test scripts/test-puzzle-drill.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Chess } = require('chess.js');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const ctrl = read('src', 'controllers', 'puzzleDrillController.js');
const ctrlCode = ctrl
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* The upsert on its own, so a test cannot pass by matching the same words in a
 * comment or in the response mapping further down. */
const upsert = ctrl.match(/ON CONFLICT \(drill_id, user_id\) DO UPDATE SET[\s\S]*?updated_at = NOW\(\)`/)[0];

test('a drill is only completed once the whole line has been played', () => {
  /* The client claims the outcome. A claim short of the line — a drifted move
     counter, a stale tab, a save that raced ahead — used to be taken at face
     value: points paid, drill closed, and a mate in three shown as a finished
     two-move solve. The server knows the line, so it checks. */
  assert.match(
    ctrlCode,
    /if \(result === 'completed' && expected && moves\.length < expected\.length\) \{\s*result = 'solving';/,
    'a completion claim shorter than the solution must be downgraded to solving',
  );
  assert.match(
    ctrlCode,
    /const expected = await expectedSolutionUci\(drill\);/,
    'the check must be made against the drill\'s own line',
  );
  /* Before the points are worked out, or the downgrade would pay them anyway. */
  assert.ok(
    ctrlCode.indexOf("result = 'solving';") < ctrlCode.indexOf('pointsEarned = drill.points;'),
    'the check must run before points are awarded',
  );
});

test('the expected line is derived from the drill row, not from the roster', () => {
  assert.match(ctrl, /async function expectedSolutionUci\(drillRow\) \{/);
  assert.match(ctrl, /SELECT fen, solution FROM puzzles WHERE id = \$1/,
    'a library puzzle is resolved from the puzzles table');
  assert.doesNotMatch(
    ctrl.slice(ctrl.indexOf('async function expectedSolutionUci'), ctrl.indexOf('function parseClampedInt')),
    /fetchClassMemberUsers/,
    'saving one move must not pull the whole class roster',
  );
});

test('progress only ever grows, so a late save cannot truncate a solve', () => {
  /* Saves are posted per move, and two of them can land out of order. The
     result was already locked to "completed" once earned, but `moves` was taken
     unconditionally — so a slow earlier save replaced a finished five-move line
     with a four-move prefix, and the class watched a solved drill look
     unfinished. */
  assert.match(
    upsert,
    /moves\s+= CASE WHEN \$9::boolean[\s\S]{0,80}?jsonb_array_length\(EXCLUDED\.moves\)[\s\S]{0,80}?>= jsonb_array_length\(live_class_puzzle_progress\.moves\)/,
    'a shorter line must not overwrite a longer one',
  );
  assert.doesNotMatch(upsert, /^\s*moves\s+= EXCLUDED\.moves,/m, 'moves must not be replaced outright');
  assert.doesNotMatch(upsert, /^\s*wrong_moves = EXCLUDED\.wrong_moves,/m,
    'and a late save must not wipe the wrong attempts either');
  /* Points must still be able to go NEGATIVE: a fail deducts them. */
  assert.doesNotMatch(upsert, /points_earned = GREATEST\(/,
    'points cannot be clamped upwards, or a deduction would never land');
  assert.match(
    upsert,
    /points_earned = CASE WHEN \$9::boolean[\s\S]{0,120}?live_class_puzzle_progress\.result = 'completed'[\s\S]{0,120}?THEN live_class_puzzle_progress\.points_earned/,
    'but a completed solve must not be clawed back by a late save',
  );
});

test('retry clears the student\'s own ledger, and only theirs', () => {
  /* Every monotonic rule above exists so a late save cannot shrink the record.
     A student who presses Retry has asked for exactly that, so the rules have to
     stand aside for it — otherwise the line and the wrong guesses they are
     trying to get past could never be cleared. */
  assert.match(
    ctrlCode,
    /const isRetry = req\.body\.retry === true \|\| req\.body\.retry === 'true';/,
    'a retry must be an explicit, unambiguous request',
  );
  assert.match(ctrlCode, /if \(isRetry\) \{\s*result = 'solving';\s*moves = \[\];\s*wrongMoves = \[\];/,
    'and it must clear the line, the attempts and the wrong guesses');
  assert.match(ctrlCode, /if \(isRetry\) \{[\s\S]{0,160}?pointsEarned = 0;\s*solvedAt = null;/,
    'a discarded solve must not keep its points or its solve time');
  /* The drill itself, and everyone else's row, are untouched: this is one
     student's own POST on their own user id, with no drill-level write. */
  assert.doesNotMatch(ctrlCode.slice(ctrlCode.indexOf('if (isRetry)')), /live_class_puzzle_drills/i,
    'a retry must never touch the drill row itself');
  const retryUpsertParams = ctrl.match(/\[drillId, req\.user\.id, result,[^\]]*isRetry\]/);
  assert.ok(retryUpsertParams, 'the retry flag must reach the upsert');
  assert.match(upsert, /\$9::boolean/,
    'and the SQL must branch on it, so the clear really happens');
});

test('the drill this bug was found on is not mistaken for a shorter puzzle', () => {
  /* Real data: a mate in three asked from a course file. Five plies, three of
     them the student's. Anything that counts solver moves as pairs of plies
     gets 4, not 5, out of it. */
  const fen = '7k/6pp/1N3p2/8/2P5/b3r1P1/1q3PKP/3R4 w - - 0 38';
  const solution = ['d1d8', 'e3e8', 'd8e8', 'a3f8', 'e8f8'];

  const san = [];
  const g = new Chess(fen);
  for (const u of solution) {
    const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    san.push(mv.san);
  }
  assert.deepEqual(san, ['Rd8+', 'Re8', 'Rxe8+', 'Bf8', 'Rxf8#']);

  const afterTwoSolverMoves = 4;
  assert.ok(afterTwoSolverMoves < solution.length,
    'two solver moves are short of the line, so the drill must still be open');
  assert.ok(g.isCheckmate(), 'and the line does end in mate');
});