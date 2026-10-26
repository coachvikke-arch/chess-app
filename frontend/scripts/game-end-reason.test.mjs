// Regression test for the "show HOW a game ended" feature.
//   run with: node --test scripts/game-end-reason.test.mjs   (from frontend/)
//
// REQUIREMENT (user): the live classroom should show WHY a game ended, not just
// the winner — e.g. "Black wins · Resignation", "White wins · Checkmate",
// "Draw · Stalemate". `online_games.result` stores WHO won; a new
// `result_reason` column stores WHY.
//
// Guards the whole path: backend records a reason on every finish route and
// both viewers (instructor's SpectatorBoard card + the student's PvPPlayBoard)
// render it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const spectator = read('src', 'components', 'SpectatorBoard.jsx');
const pvp = read('src', 'components', 'liveclass', 'PvPPlayBoard.jsx');
const controller = read('..', 'backend', 'src', 'controllers', 'onlineController.js');

test('SpectatorBoard labels the winner WITH the end reason', () => {
  assert.match(spectator, /function resultLabel\(status, result, reason\)/,
    'resultLabel must take a reason');
  assert.match(spectator, /const REASON_LABELS = \{[\s\S]*resignation: 'Resignation'/,
    'the reason -> label map must exist');
  assert.match(spectator, /resultLabel\(snap\.status, snap\.result, snap\.resultReason\)/,
    'the finished chip must pass the reason through');
});

test('SpectatorBoard carries resultReason through its snapshots', () => {
  assert.match(spectator, /resultReason: s\.resultReason/,
    'seed() must keep resultReason from the session payload');
  assert.match(spectator, /resultReason: pl\.resultReason/,
    'live game updates must keep resultReason');
});

test('PvPPlayBoard shows the end reason to the students', () => {
  assert.match(pvp, /function resultLabel\(result, reason\)/,
    'the student label must take a reason');
  assert.match(pvp, /resultLabel\(game\.result, game\.resultReason\)/,
    'the student board must pass the reason through');
  assert.match(pvp, /setEnded\(\{ result: row\.result, reason: row\.resultReason/,
    'the ended state must remember the reason');
});

test('backend records a reason on every finish route', () => {
  assert.match(controller, /result_reason = 'resignation'/,
    'resign must record a resignation');
  assert.match(controller, /result_reason = 'timeout'/,
    'flag fall must record a timeout');
  assert.match(controller, /result_reason = 'agreement'/,
    'a no-result end must record agreement');
  assert.match(controller, /result_reason = \$5[\s\S]*reason,/,
    'move results must persist the computed reason');
  for (const why of ['checkmate', 'stalemate', 'repetition', 'insufficient']) {
    assert.match(controller, new RegExp(`reason = '${why}'`),
      `the move handler must derive a '${why}' reason`);
  }
});

test('the reason travels to viewers in both payloads', () => {
  const hits = controller.match(/resultReason: row\.result_reason \|\| null,/g) || [];
  assert.ok(hits.length >= 2,
    'both payload() and spectatePayload() must expose resultReason');
});
