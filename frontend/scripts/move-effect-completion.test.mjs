/* Outcome-card completion gate.
 *
 * Run: node --test scripts/move-effect-completion.test.mjs
 *
 * Cards must wait for the checkmate animation, but never hang: every surface
 * can be cancelled, duplicate board reports are ignored, and an animation that
 * never reports still releases the card once the badge window is over.
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOVE_EFFECT_REVEAL_DELAY_MS,
  notifyMoveEffectEnd,
  revealAfterCheckmate,
} from '../src/effects/moveEffect/completion.js';
import { T } from '../src/effects/moveEffect/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

test('reduced motion reveals immediately and never subscribes', () => {
  const seen = [];
  const cancel = revealAfterCheckmate({ to: 'h8', reduced: true }, (info) => seen.push(info));
  assert.deepEqual(seen, [{ reduced: true }]);
  notifyMoveEffectEnd({ type: 'checkmate', to: 'h8', id: -1 });
  cancel();
  assert.equal(seen.length, 1);
});

test('a matching checkmate reveal fires on the board signal', () => {
  const seen = [];
  revealAfterCheckmate({ to: 'h8', reduced: false }, (info) => seen.push(info));
  notifyMoveEffectEnd({ type: 'promotion', to: 'h8', id: -2 });
  assert.equal(seen.length, 0, 'other effect types do not release the card');
  notifyMoveEffectEnd({ type: 'checkmate', to: 'a1', id: -3 });
  assert.equal(seen.length, 0, 'a different square does not release the card');
  const request = { type: 'checkmate', to: 'h8', id: -4 };
  notifyMoveEffectEnd(request);
  assert.deepEqual(seen, [{ effect: request }]);
});

test('duplicate board reports are ignored', () => {
  let calls = 0;
  revealAfterCheckmate({ to: 'h8', reduced: false }, () => { calls += 1; });
  const request = { type: 'checkmate', to: 'h8', id: 424242 };
  notifyMoveEffectEnd(request);
  notifyMoveEffectEnd(request);
  assert.equal(calls, 1);
});

test('cancelling drops a pending reveal', () => {
  let calls = 0;
  const cancel = revealAfterCheckmate({ to: 'h8', reduced: false }, () => { calls += 1; });
  cancel();
  notifyMoveEffectEnd({ type: 'checkmate', to: 'h8', id: -5 });
  assert.equal(calls, 0);
});

test('the same mate in a later game is not treated as already shown', () => {
  /* Rematch, play the same line, mate again: the position (and therefore the
     destination) repeats. The card must come back - a global "already shown"
     set left `resultRevealPending` true forever and the second game never
     showed a result at all. */
  const seen = [];
  revealAfterCheckmate({ to: 'h8', reduced: false }, () => seen.push(1));
  notifyMoveEffectEnd({ type: 'checkmate', to: 'h8', id: -10 });
  revealAfterCheckmate({ to: 'h8', reduced: false }, () => seen.push(2));
  notifyMoveEffectEnd({ type: 'checkmate', to: 'h8', id: -11 });
  assert.equal(seen.length, 2);
});

test('an animation that never reports releases the card before the choreography ends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [];
  revealAfterCheckmate({ to: 'h8', reduced: false }, (info) => seen.push(info));
  t.mock.timers.tick(MOVE_EFFECT_REVEAL_DELAY_MS - 1);
  assert.equal(seen.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(seen, [{ fallback: true }]);
  /* Waiting for T.end put the win/loss card 3.6 s+ after the mate. */
  assert.ok(MOVE_EFFECT_REVEAL_DELAY_MS < T.end,
    'the card must not wait for the whole timeline');
});

test('the board reports the end of its overlay', () => {
  const board = src('components/ChessBoard.jsx');
  assert.match(board, /import \{[\s\S]*?notifyMoveEffectEnd[\s\S]*?\} from '\.\.\/effects\/moveEffect';/);
  assert.match(board, /onDone=\{\(\) => notifyMoveEffectEnd\(moveEffect\)\}/);
  // a cleared effect still releases cards waiting on it
  assert.match(board, /if \(req === null\) \{[\s\S]*?notifyMoveEffectEnd\(activeEffectRef\.current\);/);
});

test('every outcome card is gated behind the reveal', () => {
  const files = {
    puzzlePlayer: src('components/PuzzlePlayer.jsx'),
    puzzles: src('pages/Puzzles.jsx'),
    drillBoard: src('components/liveclass/SharedChessBoard.jsx'),
    drill: src('components/liveclass/PuzzleDrill.jsx'),
    bot: src('pages/BotGamePage.jsx'),
    analysis: src('pages/AnalysisBoard.jsx'),
    pvp: src('components/liveclass/PvPPlayBoard.jsx'),
  };
  for (const [name, file] of Object.entries(files)) {
    assert.match(file, /revealAfterCheckmate/, `${name} waits for the animation`);
  }
  assert.match(files.puzzlePlayer, /revealAfterCheckmate\(\s*\{[\s\S]*?to: result\.lastMove\?\.to/);
  assert.match(files.puzzles, /revealAfterCheckmate\(\s*\{[\s\S]*?to: meta\.lastMove\?\.to/);
  assert.match(files.drillBoard, /drillFinishing/);
  assert.match(files.drill, /resultHidden/);
  assert.match(files.bot, /resultReady/);
  assert.match(files.analysis, /resultRevealPending/);
  assert.match(files.analysis, /open=\{!resultDismiss && !resultRevealPending\}/);
  assert.match(files.pvp, /resultShown/);
});

test('opening a finished game shows its result at once', () => {
  const analysis = src('pages/AnalysisBoard.jsx');
  /* Position loads (PGN/FEN/new game) are not animated, so they clear the gate. */
  assert.equal((analysis.match(/clearMateReveal\(\);/g) || []).length >= 4, true,
    'loadFen/loadPgn/setGame/applyOnline clear the gate');
  assert.match(analysis, /onlineSeenActiveRef\.current === row\.id/,
    'only a live online finish waits');
  assert.match(analysis, /seenActiveGameRef|onlineSeenActiveRef/);

  const pvp = src('components/liveclass/PvPPlayBoard.jsx');
  assert.match(pvp, /const liveFinish = seenActiveGameRef\.current === row\.id;/);
  assert.match(pvp, /if \(liveFinish && \(row\.resultReason \|\| ''\) === 'checkmate'\)/);
});

test('waiting cards are cancelled on unmount so they cannot leak', () => {
  for (const p of [
    'components/PuzzlePlayer.jsx',
    'pages/Puzzles.jsx',
    'components/liveclass/SharedChessBoard.jsx',
    'components/liveclass/PuzzleDrill.jsx',
    'pages/BotGamePage.jsx',
    'pages/AnalysisBoard.jsx',
    'components/liveclass/PvPPlayBoard.jsx',
  ]) {
    const file = src(p);
    assert.match(file, /(?:revealCancelRef|drillRevealCancelRef|resultRevealCancelRef|fxRevealCancel)[\s\S]*?\.current\(\)/, `${p} cancels a pending reveal`);
  }
});
