/* ──────────────────────────────────────────────────────────────────────────
 * The imported-game review card must PLAY the move animations.
 *
 * The regression: the card opened over another board (the Game Review board
 * behind it, the Chess Profile page), and a move effect that names no board
 * goes to the board the user touched LAST — the one BEHIND the card. The
 * effect therefore played somewhere the user was not looking and the card's
 * own board stayed completely still, so a promotion, a mate and a brilliant
 * move all stepped through in silence.
 *
 * The fix: the card names its board (an explicit effect host id) and addresses
 * every effect to it. The event itself is read from the MOVE DATA — a
 * promotion from the "=" in the SAN or the promotion flag, a mate from the
 * position the move produced or the "#" in the SAN, a brilliant from the
 * engine's classification once the analysis has landed.
 *
 * Run: node --test scripts/card-move-effect.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const CARD = read('src/components/GameViewerCard.jsx');
const BOARD = read('src/components/ChessBoard.jsx');
const PLAY = read('src/effects/moveEffect/playForMove.js');
const INDEX = read('src/effects/moveEffect/index.js');

/* ── the card addresses the effect to its own board ──────────────────────── */

test('the board can be named by its parent', () => {
  assert.match(BOARD, /moveEffectHostId: moveEffectHostIdProp = null/,
    'the board must accept an explicit host id');
  assert.match(BOARD, /const moveEffectHostId = moveEffectHostIdProp \|\| generatedHostId;/,
    'the named id must win over the generated one');
  assert.match(BOARD, /registerMoveEffectHost\(moveEffectHostId\)/,
    'the board must register under the id it was given');
});

test('the card names its board and addresses the effect to it', () => {
  assert.match(CARD, /const effectHostId = useId\(\)/);
  assert.match(CARD, /moveEffectHostId=\{effectHostId\}/,
    'the card\'s board must be named');
  assert.match(CARD, /boardId: effectHostId/,
    'the effect must be addressed to the card\'s own board');
});

/* ── the event comes from the move data ──────────────────────────────────── */

test('a promotion is detected from the move, not from a badge', () => {
  assert.match(PLAY, /const isPromotion = Boolean\(move\.promotion\) \|\| san\.includes\('='\)/);
  assert.match(PLAY, /promotionPiece: move\.promotion \|\| \(san\.includes\('='\) \? san\.split\('='\)\[1\] : null\) \|\| null/,
    'the promoted piece must be read from the move as well');
});

test('a mate is detected from the position or the SAN', () => {
  assert.match(PLAY, /let isMate = false;[\s\S]{0,120}isMate = game\.isCheckmate\(\)/);
  assert.match(PLAY, /const isCheckmate = isMate \|\| san\.endsWith\('#'\)/);
});

test('a brilliant comes from the engine classification', () => {
  assert.match(PLAY, /isSigmaVerdict\(verdict\) \? 'brilliant'/);
  assert.match(CARD, /const row = review\?\.verdicts\?\.\[target - 1\] \|\| null;/,
    'the card reads the stored verdict for the ply it is showing');
  assert.match(CARD, /verdict: row\?\.verdict \|\| null/);
});

/* ── it plays on every step, and it never sticks ─────────────────────────── */

test('every navigation path goes through the same go()', () => {
  /* The nav buttons and the keyboard all call go(); the card has no other way
     of moving, so one call site covers ▶ ◀ ⏮ ⏭ and the arrow keys. */
  assert.match(CARD, /onClick=\{\(\) => go\(0\)\}/, 'start');
  assert.match(CARD, /onClick=\{\(\) => go\(moveIndex - 1\)\}/, 'previous');
  assert.match(CARD, /onClick=\{\(\) => go\(moveIndex \+ 1\)\}/, 'next');
  assert.match(CARD, /onClick=\{\(\) => go\(parsed\.moves\.length\)\}/, 'end');
  assert.match(CARD, /prev: \(\) => go\(moveIndex - 1, true, 'keyboard'\)/);
  assert.match(CARD, /next: \(\) => go\(moveIndex \+ 1, true, 'keyboard'\)/);
  assert.match(CARD, /first: \(\) => go\(0, true, 'keyboard'\)/);
  assert.match(CARD, /last: \(\) => go\(parsed\.moves\.length, true, 'keyboard'\)/);
  assert.match(CARD, /onClick=\{\(\) => go\(idx \+ 1\)\}/, 'a click on a move in the sheet');
});

test('a new effect cancels the previous one, so quick clicks cannot overlap', () => {
  assert.match(INDEX, /if \(getMoveEffectRun\(\)\) clearMoveEffectRun\('replaced'\)/,
    'starting an effect must cancel the run before it');
  assert.match(INDEX, /request\.runId = request\.id/,
    'every run is its own, so a stale timer cannot clear a newer run');
});

test('the effect follows the board orientation', () => {
  assert.match(CARD, /orientation,/,
    'the card must tell the effect which way the board is turned');
  assert.match(PLAY, /boardOrientation: orientation/);
  assert.match(BOARD, /orientation: req\.boardOrientation === 'black' \? 'black' : 'white'/);
});
