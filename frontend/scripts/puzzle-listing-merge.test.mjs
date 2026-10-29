// Regression tests for the PuzzleListing browse+select card -
//   run with: node --test scripts/puzzle-listing-merge.test.mjs   (from frontend/)
//
// The set navigation and the bulk-selection tools used to be two separate
// cards: a white sticky bar on top and an amber panel below it. They looked
// unrelated, aligned to different edges, and the page carried a third amber
// strip for the same paginator below the grid.
//
// Properties asserted here (each one is a regression that already happened once):
//  1. Browse AND select live in ONE card, so a future edit cannot split them
//     back into two panels again.
//  2. One padding scale and one hairline divider style, so the rows line up.
//  3. The folder dropdown is the filter and the disclosure is labelled as the
//     management tool it is - they were both labelled "folders" and read as
//     duplicate controls for a single piece of state.
//  4. No amber card panel survives, and the duplicate paginator matches the card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* The catalogue was lifted out of the page into a component so the Admin
   Homework "Assign puzzles" card can render the same list (task: one shared
   listing). The card itself is what these properties describe, so the test
   reads the component, not the one-line page wrapper. */
const src = readFileSync(join(ROOT, 'src', 'components', 'PuzzleListing.jsx'), 'utf8');

/* The region that opens the card ... and the region that closes it. Anything
 * inside is "part of the one card"; anything outside is not. */
const cardOpen = src.indexOf('/* ONE card for browsing, filtering');
/* the card ends at the `</div>` + `)}` that close the {currentSet && ( ... )} */
const cardEnd = cardOpen === -1 ? -1 : src.slice(cardOpen).search(/\n {8}<\/div>\r?\n {6}\)\}/);
const inside = cardOpen === -1 || cardEnd === -1 ? '' : src.slice(cardOpen, cardOpen + cardEnd);

test('browse and select controls live in one card', () => {
  assert.notEqual(cardOpen, -1, 'the merged card must be marked so it can be found');
  assert.ok(inside.length > 0, 'the merged card body must be locatable');

  for (const [what, needle] of [
    ['set navigation', 'Show'],
    ['page size', 'perPage'],
    ['folder filter', 'FolderTree'],
    ['manage-folders disclosure', 'Manage folders'],
    ['selection count', 'Selected:'],
    ['select-all', 'Select all'],
    ['deselect-all', 'Deselect all'],
    ['assign action', 'setAssignOpen(true)'],
    ['range readout', '{rangeStart}'],
    ['paginator', '{paginator}'],
  ]) {
    assert.ok(inside.includes(needle), `${what} must be inside the single card, not beside it`);
  }
});

test('the rows share one padding scale and one divider style', () => {
  const rows = inside.match(/className="[^"]*(?:px-4)[^"]*"/g) || [];
  assert.ok(rows.length >= 4,
    `every row must use the same horizontal padding, found ${rows.length} px-4 rows`);

  assert.ok(!/py-3 mb-5 space-y-3/.test(inside),
    'the old amber panel spacing must be gone');
  assert.ok(!/-mx-4 px-4 pl-16/.test(inside),
    'the old full-bleed sticky bar must not survive inside the card');
});

test('the folder dropdown filters and the disclosure manages', () => {
  assert.match(inside, /Manage folders/,
    'the disclosure must say what it does, so it stops reading as a second filter');
  assert.ok(!/>\s*Folder browser\s*\{/.test(src),
    'the old "Folder browser" label is what made the two controls look duplicated');
  /* the tree is the management UI, and it must still write back to the filter */
  assert.match(inside, /onSelect=\{\(id\) => setFolderFilter\(id \?\? 'all'\)\}/,
    'picking a folder in the tree must still drive the filter above');
  assert.match(inside, /onChanged=\{\(\) => \{[\s\S]{0,200}setRefreshKey/,
    'folder edits must still refresh the sets below');
});

test('no amber panel survives, and the paginator lives inside the card', () => {
  assert.ok(!/border-amber-400\/50 bg-amber-400\/10/.test(src),
    'the amber panel style must be gone from this page');

  /* The card is the only shell now: the second paginator strip that used to
     sit below the grid was folded into it, which the needle list above proves
     by finding `{paginator}` inside the card region. */
  assert.match(src, /rounded-2xl border border-ink-200 bg-white(?:\/\d+)?/,
    'the card must use the shared light card shell');
});

test('light-background text is not left in dark-theme colours', () => {
  /* This page is light (bg-white/90 card on a light page). text-ivory-* is a
   * cream that is unreadable there - the selection row and empty states were
   * using it, which is why the counts were hard to read. The rename dialog and
   * the toast are genuinely dark, so they keep it. */
  const lightRegion = src.slice(0, src.indexOf('Rename set'));
  assert.ok(!/text-ivory-/.test(lightRegion),
    'no ivory text may appear on the light page above the dark rename dialog');
});