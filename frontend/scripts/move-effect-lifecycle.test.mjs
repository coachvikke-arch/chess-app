import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  afterMoveEffectEnd,
  beginMoveEffectRun,
  clearMoveEffectRun,
  endMoveEffectRun,
  getMoveEffectRun,
  getMoveEffectRunId,
  isMoveEffectRunning,
  subscribeMoveEffectState,
} from '../src/effects/moveEffect/runtime.js';

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

function request(overrides = {}) {
  return { id: 101, type: 'checkmate', source: 'test', to: 'h8', ...overrides };
}

test.afterEach(() => {
  endMoveEffectRun(undefined, 'test-cleanup');
});

test('the runtime exposes one authoritative run with start/end reasons', () => {
  const states = [];
  const unsubscribe = subscribeMoveEffectState((state) => states.push(state.reason));

  assert.equal(isMoveEffectRunning(), false);
  beginMoveEffectRun(request());
  assert.equal(isMoveEffectRunning(), true);
  assert.equal(getMoveEffectRunId(), 101);
  assert.equal(getMoveEffectRun().source, 'test');

  assert.equal(endMoveEffectRun(request({ id: 999 }), 'stale'), false, 'a stale run cannot end the current one');
  assert.equal(isMoveEffectRunning(), true);

  assert.equal(endMoveEffectRun(request(), 'timeline-end'), true);
  assert.equal(isMoveEffectRunning(), false);
  assert.deepEqual(states, ['subscribe', 'start', 'timeline-end']);

  unsubscribe();
  clearMoveEffectRun('noop');
});

test('a replacement run ends the previous one before the new one starts', () => {
  const reasons = [];
  const unsubscribe = subscribeMoveEffectState(({ reason }) => reasons.push(reason));
  beginMoveEffectRun(request({ id: 1, source: 'first' }));
  endMoveEffectRun(request({ id: 1, source: 'first' }), 'replaced');
  beginMoveEffectRun(request({ id: 2, source: 'second' }));
  assert.equal(getMoveEffectRunId(), 2);
  assert.deepEqual(reasons, ['subscribe', 'start', 'replaced', 'restart', 'start']);
  unsubscribe();
});

test('afterMoveEffectEnd runs immediately when idle and once after a run', () => {
  let idle = 0;
  afterMoveEffectEnd(() => { idle += 1; });
  assert.equal(idle, 1);

  let deferred = 0;
  beginMoveEffectRun(request({ id: 303 }));
  const cancel = afterMoveEffectEnd(() => { deferred += 1; });
  assert.equal(deferred, 0);
  endMoveEffectRun(request({ id: 303 }), 'timeline-end');
  assert.equal(deferred, 1);

  beginMoveEffectRun(request({ id: 404 }));
  let cancelled = 0;
  const second = afterMoveEffectEnd(() => { cancelled += 10; });
  second();
  endMoveEffectRun(request({ id: 404 }), 'timeline-end');
  assert.equal(cancelled, 0, 'a cancelled waiter never fires');
  cancel();
});

test('ChessBoard releases hidden pieces from runtime state and builds from req.fen', () => {
  const board = src('components/ChessBoard.jsx');
  assert.match(board, /subscribeMoveEffectState\(\(\{ state, request, hiddenSquares: hidden \}\) =>/);
  assert.match(board, /if \(state === 'idle'\) setMoveEffect\(null\);/);
  assert.match(board, /let effectGame = game;[\s\S]*?new Chess\(req\.fen\)/);
  assert.match(board, /onDone=\{\(\) => notifyMoveEffectEnd\(moveEffect\)\}/);
});

test('feedback is dropped, not queued, while an effect runs', () => {
  const hook = src('components/puzzle/MoveFeedbackOverlay.jsx');
  const player = src('components/PuzzlePlayer.jsx');
  assert.match(hook, /if \(suppressRef\.current && isMoveEffectRunning\(\)\)/);
  assert.match(hook, /suppressed-during-effect/);
  assert.match(hook, /return false;/);
  assert.match(player, /if \(isMoveEffectRunning\(\)\)/);
  assert.match(player, /feedback-suppressed-during-effect/);
  assert.match(player, /subscribeMoveEffectState/);
});

test('review surfaces trigger effects through the shared ply helper', () => {
  const helper = src('effects/moveEffect/playForMove.js');
  assert.match(helper, /export function playEffectForMove\(moveIndex, source/);
  assert.match(helper, /isSigmaVerdict\(verdict\)/);
  assert.match(helper, /move\.promotion/);
  assert.match(helper, /game\.isCheckmate\(\)/);
  assert.match(helper, /fen: game\.fen\(\)/);

  for (const file of ['pages/GameReview.jsx', 'pages/AnalysisBoard.jsx', 'components/GameViewerCard.jsx']) {
    const text = src(file);
    assert.match(text, /playEffectForMove\(/, `${file} must trigger effects on navigation`);
  }
});

test('sound and haptics use the requested strength values', () => {
  const config = src('effects/moveEffect/config.js');
  const haptics = src('effects/moveEffect/haptics.js');
  const sound = src('utils/sound.js');
  const prefs = src('config/haptics.js');

  /* The sigma cue is deliberately lifted (it is a low thud, the first thing a
     phone speaker throws away); the shared master bus still limits it. */
  assert.match(config, /gainScale: 2\b/);
  assert.match(config, /tick: \{ at: 50, ms: 40 \}/);
  assert.match(config, /accent: \{ at: 380, ms: 40 \}/);
  assert.match(config, /onMs: \[12, 18, 24, 30, 38, 38, 38, 38, 38, 38, 38, 33, 21, 12\]/);
  assert.match(haptics, /getHapticStrength/);
  assert.match(haptics, /HAPTIC_PATTERNS/);
  assert.match(haptics, /promotion/);
  assert.match(haptics, /brilliant/);
  assert.match(haptics, /checkmate/);
  assert.match(sound, /cueGain/);
  assert.match(prefs, /DEFAULT_HAPTIC_STRENGTH = 'strong'/);
  assert.match(prefs, /HAPTIC_STRENGTHS/);
});
