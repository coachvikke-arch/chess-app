// Regression test for the Play Arena post-game board behaviour
// (frontend/src/pages/AnalysisBoard.jsx) —
//   run with: node --test scripts/arena-postgame.test.mjs   (from frontend/)
//
// REQUIREMENT (revised): when a game ends the board must **RESET** back to the
// starting position — it must NOT change sides. An earlier implementation
// auto-flipped the board to the winner; the user explicitly asked for the
// opposite.
//
// Two things this guards:
//  1. No orientation change on game end. Besides being unwanted, flipping was
//     unsafe: buildResult() derives the player's own side as
//     `computerOn ? computerColor : orientation`, so in pass-and-play the side
//     comes FROM `orientation`. Flipping there would flip `won`, rewrite the
//     popup from "You Won!" to "You Lost", change this effect's dedupe key and
//     re-fire — oscillating, and reporting a result that is simply wrong.
//  2. The reset must happen on DISMISS, not the instant the game ends, because
//     two consumers still need the live board: `goToGameReview()` reads
//     gameRef.current.pgn() for the Review button, and the game-end effect has
//     already saved that PGN to the backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');

/* The game-end effect: everything between the dedupe guard and the backend save. */
const effectStart = src.indexOf('/* auto-open the popup the moment a game ends');
assert.notEqual(effectStart, -1, 'the auto-open result effect must exist');
const effect = src.slice(effectStart, effectStart + 2200);

test('the game-end effect does NOT change the board orientation', () => {
  /* The regression the user reported: the board used to flip to the winner. */
  assert.ok(!/setOrientation\(winner\)/.test(effect),
    'the game-end effect must not rotate the board to the winner');
  assert.ok(!/const winner = String\(finalResult\.winner/.test(effect),
    'no winner-driven orientation logic belongs in the game-end effect');
});

test('dismissing the result does NOT reset the board', () => {
  /* The user asked for reset on the BUTTON only. An earlier version reset the
     board here automatically; the board must stay on the final position so the
     finished game can still be read, replayed or reviewed. */
  const closeIdx = src.indexOf('onClose: () => { setResultPopup(null); setResultDismiss(true); }');
  assert.notEqual(closeIdx, -1, 'onClose must be the plain dismiss (no reset)');
  const onClose = src.slice(closeIdx, closeIdx + 220);
  assert.ok(!/startNewGame\(\)/.test(onClose),
    'closing the result must NOT reset the board');
  assert.ok(!/goToMove\(/.test(onClose),
    'closing the result must NOT move the board');
  /* It must still clear the popup / dismissal flag, or the overlay sticks. */
  assert.match(onClose, /setResultPopup\(null\)/);
  assert.match(onClose, /setResultDismiss\(true\)/);
});

test('reset is the explicit ↺ button, and it keeps the game', () => {
  /* `reset()` is position-only: it returns the board to the start via
     goToMove(0) while KEEPING the move list, so the game can be replayed with
     ⏮ ◀ ▶ ⏭. It used to call setMoves([]), which silently destroyed a rated
     game on a "Reset position" click. */
  /* Strip /* … *\/ comments first: the function's own comment explains that it
     USED to call setMoves([]), which would otherwise satisfy a naive match. */
  const raw = src.slice(src.indexOf('function reset()'), src.indexOf('function startNewGame()'));
  const fn = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(fn, /goToMove\(0\)/,
    'the reset button must return the board to the starting position');
  assert.ok(!/setMoves\(\[\]\)/.test(fn),
    'the reset button must NOT wipe the move list — that loses the game');
  /* The button must actually be wired to it. */
  assert.match(src, /onClick=\{reset\}[^>]*title="Reset position"/,
    'the ↺ control must still be wired to reset()');
});

test('the Review path does NOT reset — it needs the live board PGN', () => {
  const reviewIdx = src.indexOf('onReview:');
  assert.notEqual(reviewIdx, -1, 'onReview must exist');
  const onReview = src.slice(reviewIdx, reviewIdx + 320);
  assert.match(onReview, /goToGameReview\(\)/);
  assert.ok(!/startNewGame\(\)/.test(onReview),
    'Review must NOT reset the board — it reads gameRef.current.pgn() first');
  assert.match(src, /const pgn = gameRef\.current\.pgn\(\);/,
    'goToGameReview must still read the PGN from the live board');
});

test('the once-per-game guard still precedes everything in the effect', () => {
  const guardIdx = effect.indexOf('if (resultSeenRef.current === key) return;');
  assert.ok(guardIdx >= 0, 'the game-end dedupe guard must exist');
  assert.ok(guardIdx < effect.indexOf('setResultPopup(finalResult)'),
    'the dedupe guard must run before the popup is opened');
});
