// Regression tests for the Game Review MOVE LIST (score sheet) layout —
//   run with: node --test scripts/movelist-layout.test.mjs   (from frontend/)
//
// The sheet must read as aligned rows of "12. Nf3 Nf6", never as a vertical
// run of "1. / e3 / e5 / 2. / …".
//
// The bug this guards: `.gr-mvpair` was `display: contents` inside a
// `repeat(auto-fill, minmax(7.5rem, 1fr))` grid. `display: contents` removes the
// pair's own box, so its three children — the move number, White's move and
// Black's move — became three INDEPENDENT grid items of the OUTER grid. In a
// narrow moves panel auto-fill collapses to one column, so those three items
// each took their own line: the score sheet collapsed into one move per line
// and the number/reply columns drifted out of alignment.
//
// Fix: the PAIR is the grid item; it lays itself out as a fixed 3-column nested
// grid (number | white | black), so a pair is atomic and can never be split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const page = readFileSync(join(ROOT, 'src', 'pages', 'GameReview.jsx'), 'utf8');

/* Collect EVERY declaration block that mentions `sel`, so a selector shared
   with another (`.gr-mvhead, .gr-mvpair { … }`) is not missed — and neither is
   the part of it that actually lives in a later single-selector rule. */
const rule = (sel) => {
  const re = new RegExp(`(?:^|[},])\\s*${sel.replace('.', '\\.')}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'gm');
  let out = '';
  let m;
  while ((m = re.exec(css)) !== null) out += m[1];
  assert.notEqual(out.trim(), '', `${sel} rule must exist`);
  return out;
};

test('a move pair is a real box, not display:contents', () => {
  /* The core assertion: `display: contents` is exactly what dissolved each
     pair into three independent grid items and broke the rows. */
  const pair = rule('.gr-mvpair');
  assert.ok(!/display\s*:\s*contents/.test(pair),
    '.gr-mvpair must NOT be display:contents — that splits a pair across lines');
  assert.match(pair, /display\s*:\s*grid/,
    '.gr-mvpair must lay itself out as a grid so the pair stays one row');
});

test('a pair is exactly 3 columns: number, white, black', () => {
  /* number | white-move | black-move. Fewer would drop a move; more would
     introduce an empty gutter and break alignment. */
  const cols = rule('.gr-mvpair').match(/grid-template-columns\s*:\s*([^;]+);/);
  assert.ok(cols, '.gr-mvpair must declare grid-template-columns');
  const parts = cols[1].trim().split(/\s+(?![^()]*\))/); // split on top-level spaces
  assert.equal(parts.length, 3,
    `expected 3 columns (number|white|black), got ${parts.length}: ${cols[1]}`);
  /* the move columns must be shrinkable so a long SAN cannot widen the pair */
  assert.ok(parts.filter((p) => /minmax\(0/.test(p)).length >= 2,
    'both move columns should be minmax(0, 1fr) so they can shrink');
});

test('the move number is right-aligned in its own column', () => {
  /* It used to carry `grid-column: 1 / 1`, which fought the outer auto-fill
     grid. Inside the row's own 3-column grid it just needs to be aligned — and
     the replay sheet centres it vertically with flex. */
  const num = rule('.gr-mvnum');
  assert.ok(!/grid-column\s*:/.test(num),
    '.gr-mvnum must not set grid-column — it is placed by the row grid');
  assert.match(num, /justify-content\s*:\s*flex-end|text-align\s*:\s*right/,
    'the move number should be right-aligned against the moves');
  assert.match(num, /font-variant-numeric\s*:\s*tabular-nums/,
    'tabular figures keep the number column visually straight');
});

test('move cells clip a long SAN instead of widening the column', () => {
  /* Without clipping, one "Qxf7+" would stretch its column and knock every
     other pair in that row out of alignment. */
  const mv = rule('.gr-mv');
  assert.match(mv, /min-width\s*:\s*0/);
  assert.match(mv, /overflow\s*:\s*hidden/);
  assert.match(mv, /white-space\s*:\s*nowrap/);
  assert.match(mv, /text-overflow\s*:\s*ellipsis/);
});

test('the list is the replay sheet: ONE pair per row, not tiled columns', () => {
  /* It used to be `repeat(auto-fill, minmax(9.5rem, 1fr))`, tiling pairs
     left-to-right. Denser, but it cannot carry a column header: a spanning head
     lands "White" over the left half of the panel and "Black" over the right,
     which is only true of the first pair. The single column is what makes the
     real `# | White | Black` header possible. */
  const list = rule('.gr-movelist');
  assert.ok(!/grid-template-columns\s*:/.test(list),
    '.gr-movelist must not be a grid — pairs tile sideways and break the header');
  assert.match(list, /display\s*:\s*block/);
  assert.match(list, /overflow-y\s*:\s*auto/, 'the sheet still scrolls');
});

test('the head and the rows share ONE column definition', () => {
  /* The whole point of the single column: if the head and the rows disagreed
     even slightly, the names would sit off the moves they label. */
  const head = rule('.gr-mvhead');
  const pair = rule('.gr-mvpair');
  assert.match(head, /grid-template-columns\s*:\s*2\.6rem minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    'the head must use the replay sheet columns');
  assert.match(pair, /grid-template-columns\s*:\s*2\.6rem minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    'and the rows must use the very same ones');
  assert.ok(head.includes('position: sticky') || head.includes('position:sticky'),
    'the head stays put while the game scrolls under it');
  assert.match(head, /background:\s*#f8fdff/,
    'the sticky head must be opaque, or moves scroll visibly through the names');
});

test('the markup still emits number + white + black as siblings in one pair', () => {
  /* Guards the CSS against a future JSX change: the three children must live
     inside the same .gr-mvpair element. */
  const start = page.indexOf('className="gr-mvpair"');
  assert.notEqual(start, -1, '.gr-mvpair must exist in GameReview.jsx');
  const block = page.slice(start, start + 1400);
  for (const cls of ['gr-mvnum', 'gr-mv-slot', 'gr-mv']) {
    assert.ok(block.includes(cls), `${cls} must be rendered inside the move pair`);
  }
  /* Pairs must still group the white and black ply of ONE move number.
     This used to be asserted as the literal expression `idx = i * 2 + off`,
     but that expression is only correct when White opens the game: on a
     black-opening game it put the black move in the White column and shifted
     every later ply - and with it the engine verdict keyed by ply index. The
     pairing now comes from the shared, tested buildScoreRows, which carries the
     real ply per cell. */
  assert.match(page, /buildScoreRows\(moves, fenStartsBlack\(initialFen\)\)/,
    'rows must come from the shared score-sheet pairing');
  assert.ok(!/idx\s*=\s*i\s*\*\s*2\s*\+\s*off/.test(page),
    'the row*2+column indexing must not come back: it mis-numbers a black-opening game');
  assert.match(page, /verdicts\[cell\.ply\]/,
    'each verdict must follow its own ply');
});
