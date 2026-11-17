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

test('dismissing the result starts a fresh board', () => {
  /* Reset happens on DISMISS, not the instant the game ends: `goToGameReview()`
     and the backend save both still need the live board. Closing the card then
     clears the finished game and leaves an empty board. */
  const closeIdx = src.indexOf('onClose: () => { markCurrentResultSeen(); fullReset(); }');
  assert.notEqual(closeIdx, -1, 'onClose must dismiss the result and reset the board');
  assert.match(src.slice(closeIdx, closeIdx + 120), /fullReset\(\)/);
});

test('reset is the ↺ button and it clears the game', () => {
  /* The ↺ button used to be position-only: it jumped to move 0 but left every
     move (and its verdicts) in the list, so it looked like it did nothing.
     It now clears a practice/bot game and restarts a bot game; a live online
     match is owned by the server, so there it only walks back to the start. */
  const raw = src.slice(src.indexOf('function reset()'), src.indexOf('function startNewGame()'));
  const fn = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(fn, /if \(onlineGame\) \{ goToMove\(0\); return; \}/,
    'a live online match must not have its move list cleared locally');
  assert.match(fn, /setMoves\(\[\]\)/,
    'reset must wipe the move list on a practice board');
  assert.match(fn, /startComputerGame\(computerColor\)/,
    'reset must restart a bot game with the same settings');
  /* The button must actually be wired to it. */
  assert.match(src, /onClick=\{reset\}[^>]*title="Reset board"/,
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

test('the arena board can draw annotation arrows', () => {
  /* The wrapper used to forward no arrow props at all, so ChessBoard refused
     every right-drag and arrows could not be drawn on the Play Arena board. */
  const arena = readFileSync(join(ROOT, 'src', 'components', 'ArenaBoard.jsx'), 'utf8');
  assert.match(arena, /onArrowDrawn=\{onArrowDrawn\}/,
    'ArenaBoard must forward onArrowDrawn to ChessBoard');
  assert.match(arena, /onSquareRightClick=\{onSquareRightClick\}/,
    'ArenaBoard must forward onSquareRightClick to ChessBoard');
  assert.match(arena, /onClearArrows=\{onClearArrows\}/,
    'ArenaBoard must forward onClearArrows to ChessBoard');
  assert.match(arena, /extraSquareStyles=\{extraSquareStyles\}/,
    'ArenaBoard must forward extraSquareStyles to ChessBoard');
  assert.match(arena, /arrowColorForModifiers=\{arrowColorForModifiers\}/,
    'ArenaBoard must forward the modifier colour picker to ChessBoard');
  assert.match(src, /onArrowDrawn=\{handleBoardArrowDrawn\}/,
    'the page must wire the board to its own arrow store');
  assert.match(src, /onSquareRightClick=\{handleBoardSquareRightClick\}/,
    'the page must wire right-click square marks');
  assert.match(src, /onClearArrows=\{clearBoardAnnotations\}/,
    'the page must wire left-click clearing both annotation stores');
  assert.match(src, /extraSquareStyles=\{boardSquareStyles\}/,
    'the page must paint its square marks and the check glow on the board');
  assert.match(src, /knightArrows/,
    'knight moves must be drawn as the chess.com L-shaped arrow');
});
