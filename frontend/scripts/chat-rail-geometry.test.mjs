import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chat rail geometry (desktop classroom).
 *
 * The rail has no height of its own: it is a grid item that stretches. Anything
 * that decides its height has to be asserted here, because getting it wrong is
 * invisible in a source diff and shows up as "the panel is the same height it
 * always was".
 */

const root = path.resolve(process.cwd());
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

const DESKTOP = '@media (min-width: 901px)';
const desktopBlock = css.slice(css.indexOf(DESKTOP));
const sideRule = desktopBlock.match(/\.live-room \.live-room-desktop > \.live-room-side \{([^}]*)\}/)[1];

test('the chat rail spans the whole left column, not just the board row', () => {
  /* Row 1 is the board. The spectate area is row 2 and the instructor's PvP
     section is row 3. Pinned to row 1 the panel was exactly as tall as the board
     and could not be given any extra height without enlarging the board. */
  assert.match(sideRule, /grid-row: 1 \/ span 3/, 'the rail spans board + spectate + PvP');
  assert.doesNotMatch(sideRule, /grid-row: 1;/, 'it is not pinned to the board row alone');
  assert.match(sideRule, /align-self: stretch/, 'and stretches to fill what it spans');
});

test('the span is explicit, because 1 / -1 would silently span nothing here', () => {
  /* The desktop grid sets `grid-template-columns` but never
     `grid-template-rows`, so every row is implicit. `-1` resolves against the
     LAST EXPLICIT row line, which here is line 2 - i.e. `grid-row: 1 / -1` is
     the same as `grid-row: 1` and the rail would never grow. */
  assert.doesNotMatch(sideRule, /grid-row: [^;]*\/ *-1/, 'no -1 end line');
  const grid = desktopBlock.match(/\.live-room \.live-room-desktop \{([^}]*)\}/)[1];
  assert.doesNotMatch(grid, /grid-template-rows/,
    'confirming the rows really are implicit, so -1 would be wrong');
});

test('the rail still cannot dictate the height of the rows it spans', () => {
  /* `contain: size` is what stops the rail's own content (a long chat
     transcript, a 40-student roster) from growing the left column and dragging
     the board down with it. The rail is allowed to be tall; it is not allowed
     to make anything else tall. */
  assert.match(sideRule, /contain: size/);
  assert.match(sideRule, /overflow: hidden/, 'and its overflow is clipped, not spilled');
  assert.match(sideRule, /min-height: 0/, 'so it can shrink inside the grid');
});

test('the board still owns row 1 and is not stretched by the split', () => {
  /* The whole point of spanning downwards is that the board keeps its size. If
     the board area ever picked up a row span it would grow into the space the
     rail just gained, and the change would be a no-op. */
  const drill = desktopBlock.match(/\.live-room \.live-room-desktop \.live-drill-area \{([^}]*)\}/)[1];
  assert.match(drill, /grid-row: 1;/, 'the board area stays on row 1');
  assert.doesNotMatch(drill, /grid-row: [^;]*span/, 'and spans nothing');
});