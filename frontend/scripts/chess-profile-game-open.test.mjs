/* ──────────────────────────────────────────────────────────────────────────
 * "Chess Profile → Games": clicking a game card must open THAT game.
 *
 * The regression it guards: the card click ended up in a different, unrelated
 * section of the page. Two independent causes, both asserted here:
 *
 *   1. THE VIEWER OPENED A SECOND TIME. The card pushed its own history entry
 *      and its effect depended on an inline close handler, so every parent
 *      render tore the overlay down and pushed it again — the browser ended up
 *      stepping back over entries that belonged to other sections. The overlay
 *      hook must keep the close handler in a ref, and must only step back over
 *      the entry IT pushed.
 *
 *   2. THE URL DROPPED THE GAME. The open game lives in ?game=<id>; a tab
 *      change wrote ?tab=overview over it (or left it behind), so the game was
 *      gone while the page looked like it had opened. The tab default must
 *      follow ?game=, leaving the games tab must drop ?game=, and the game must
 *      be identified by its own row id inside the 'chess_profile' source.
 *
 * Run: node --test scripts/chess-profile-game-open.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const PROFILE = read('src/pages/ChessProfile.jsx');
const OVERLAY = read('src/hooks/useOverlayHistory.js');
const CARD = read('src/components/GameViewerCard.jsx');

/* ── the overlay must not step back over somebody else's entry ────────────── */

test('the overlay hook keeps the close handler in a ref', () => {
  assert.match(OVERLAY, /closeRef\.current = closeFn/,
    'an inline close handler must not re-run the overlay effect');
  assert.match(OVERLAY, /\}, \[isOpen, id\]\)/,
    'the effect must depend on the overlay lifecycle only');
});

test('the overlay only steps back over the entry it pushed', () => {
  assert.match(OVERLAY, /state && state\.overlay === (token|id)/,
    'the cleanup must check that the current entry is still the overlay own');
  assert.doesNotMatch(
    OVERLAY,
    /return \(\) => \{[\s\S]{0,400}?cleanup\(\);[\s\S]{0,200}?window\.history\.back\(\);[\s\S]{0,80}?\};/,
    'the cleanup must not call history.back() unconditionally',
  );
});

/* ── the game is opened by its own identity, in the games tab ────────────── */

test('the open game is the row id, inside the chess_profile source', () => {
  assert.match(PROFILE, /gameRef=\{\{ gameSource: 'chess_profile', gameId \}\}/,
    'the viewer must be handed the canonical (source, id) pair');
  assert.match(PROFILE, /const resolveGame = useCallback\(\(ref\) => fetchGame\(ref\.gameId\), \[\]\)/,
    'the card must resolve the game through the profile game endpoint');
  assert.match(PROFILE, /openViewer = \(id\) => \{[\s\S]{0,120}?setSelectedId\(String\(id\)\)/,
    'the click must put the row id in the URL as a string');
});

test('the viewer opens immediately and reports its own failures', () => {
  assert.match(CARD, /gameRef = null/,
    'the card must support being opened from a reference');
  assert.match(PROFILE, /manageHistory=\{false\}/,
    'the URL entry is the history entry: the card must not push a second one');
});

test('the tab follows the open game, and leaving games drops it', () => {
  assert.match(PROFILE, /useUrlTab\('tab', hasGameParam \? 'games' : 'overview'\)/,
    'a ?game= URL must land on the games tab');
  assert.match(PROFILE, /if \(key !== 'games' \|\| closingGame\) sp\.delete\('game'\)/,
    'leaving the games tab must drop the open game from the URL');
  assert.match(PROFILE, /setSelectedId\(null, \{ replace: true \}\)/,
    'closing the game replaces the entry instead of pushing a new one');
});

test('the game row marks itself active by id, string to string', () => {
  assert.doesNotMatch(PROFILE, /active=\{selectedId === a\.game\.id\}/,
    'a URL string never equals a numeric row id');
  assert.match(PROFILE, /active=\{String\(selectedId\) === String\(a\.game\.id\)\}/,
    'the active row must be compared as strings');
});
