// Play Mode's move history is ONE sticky horizontal row, not a vertical card.
//   run with: node --test scripts/play-mode-move-strip.test.mjs   (from frontend/)
//
// What this pins, in the order the player asked for it:
//   * the boxed "Moves" list is gone, and the row that replaced it is the same
//     memoised MoveList the page already used — no second copy of the markup and
//     no second set of chess state or handlers.
//   * ⏮ ◀ sit at the left of that row, ▶ ⏭ at the right, and the old overlay nav
//     row no longer repeats them (↺ / ⇄ stay, they are not move navigation).
//   * the row is OUTSIDE .play-mode-panel-scroll, which is what makes it sticky.
//   * centring writes the strip's own scrollLeft. `scrollIntoView` is banned on
//     this page: it walks every scrollable ancestor and dragged the page along.
//   * the geometry the phone needs: 48px row, 40×40 targets, hidden scrollbar,
//     snap, and overscroll contained so a flick cannot move the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/* The body of the LAST rule whose selector ends with `sel` — the overlay-scoped
   copy of the strip rules is written after the page-scoped one, and a later rule
   is the one that wins a specificity tie. */
const ruleBody = (sel) => {
  const re = new RegExp(`[^{};]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const hits = [...css.matchAll(re)];
  assert.ok(hits.length, `no CSS rule for ${sel}`);
  return hits[hits.length - 1][1];
};

test('the vertical moves card is gone', () => {
  assert.doesNotMatch(page, /play-mode-moves-card/, 'the Play Mode card must not come back');
  assert.doesNotMatch(page, /variant="list"/, 'the list variant was the vertical card');
  assert.doesNotMatch(page, /ab-move-list|ab-move-btn|ab-move-pair|ab-move-num/,
    'the vertical list markup and its class names must be gone from the page');
  assert.doesNotMatch(css, /\.ab-move-list\b|\.ab-move-btn\b/,
    'and its stylesheet must go with it');
});

test('one row, with the four nav buttons fixed at its ends', () => {
  const start = page.indexOf('className="play-mode-movestrip"');
  assert.notEqual(start, -1, 'the strip must exist');
  const block = page.slice(start, start + 1600);

  const parts = ['\u23EE', '\u25C0', '<MoveList', '\u25B6', '\u23ED'];
  const order = parts.map((t) => block.indexOf(t));
  order.forEach((at, i) => {
    assert.ok(at > -1, `${parts[i]} must be inside the strip`);
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'the row must read [ first ] [ previous ] [ moves ] [ next ] [ last ]');

  /* The existing handlers, not new ones. */
  assert.match(block, /onClick=\{\(\) => goToMove\(0\)\} disabled=\{navLocked \|\| moveIndex === 0\}/,
    'First move');
  assert.match(block, /onClick=\{undoMove\} disabled=\{navLocked \|\| moveIndex === 0\}/,
    'Previous, disabled at the start');
  assert.match(block, /onClick=\{redoMove\} disabled=\{navLocked \|\| moveIndex >= moves\.length\}/,
    'Next, disabled at the latest');
  assert.match(block, /onClick=\{\(\) => goToMove\(moves\.length\)\} disabled=\{navLocked \|\| moveIndex >= moves\.length\}/,
    'Last move');

  /* Empty game still shows the message inside the row. */
  assert.match(block, /emptyText="No moves yet"/);
});

test('the row is sticky because it sits outside the scrolling panel', () => {
  const gap = page.slice(page.indexOf('<div className="play-mode-panel-scroll"'),
    page.indexOf('<div className="play-mode-movestrip"'));
  /* Every div opened inside the scroll region is closed again — including the
     region itself — before the strip starts. Balance zero therefore means the
     strip is the panel's LAST row, a sibling of the scroll region, not something
     the panel can scroll past. */
  const opens = (gap.match(/<div\b/g) || []).length;
  const closes = (gap.match(/<\/div>/g) || []).length;
  assert.equal(closes - opens, 0, 'the strip must close the scroll region, not live inside it');
  assert.match(css, /\.play-mode-overlay\[data-play-mode\] \.play-mode-movestrip\s*\{[^}]*flex:\s*0 0 auto/,
    'and must claim a fixed row of its own');
});

test('the overlay nav row no longer duplicates the four buttons', () => {
  const group = page.slice(page.indexOf('className="ab-ctrl-group"'),
    page.indexOf('className="ab-ctrl-chips"'));
  assert.equal((group.match(/<Button/g) || []).length, 2, 'only ↺ and ⇄ remain');
  assert.match(group, /title="Reset position"/);
  assert.match(group, /title="Flip board"/);
  for (const glyph of ['\u23EE', '\u25C0', '\u25B6', '\u23ED']) {
    assert.ok(!group.includes(glyph), `${glyph} must live in the strip, not in a second bar`);
  }
});

test('chips are the memoised list and only ever re-view a position', () => {
  assert.match(page, /const MoveList = memo\(function MoveList\(/, 'the list stays memoised');
  assert.match(page, /onClick=\{\(\) => goToMove\(idx \+ 1\)\}/,
    'a chip navigates to its own ply through the existing goToMove');
  assert.match(page, /className=\{`ab-mv\$\{current \? ' is-current'/,
    'the viewed ply is the one marked current');
  assert.doesNotMatch(page, /PlayModeMoveList/, 'the vertical scroller is gone');

  /* Navigation must not be able to play a move. */
  const strip = page.slice(page.indexOf('className="play-mode-movestrip"'),
    page.indexOf('className="play-mode-board-area"'));
  assert.doesNotMatch(strip, /gameRef\.current\.move|handleBoardMove|sendMove/,
    'the strip must never execute a chess move');
});

test('centring moves the strip only — never the page', () => {
  assert.doesNotMatch(page, /scrollIntoView\(/,
    'scrollIntoView walks every scrollable ancestor; it was the page shake');
  assert.match(page, /function centreMoveStrip\(strip\)/);
  assert.match(page, /strip\.scrollTo\(\{ left:/, 'the container scrollLeft is what is written');
  /* offsetLeft is relative to the nearest POSITIONED ancestor — the fixed overlay
     in Play Mode — so the chip and the row are both measured as rects. */
  assert.match(page, /const chip = cur\.getBoundingClientRect\(\);/);
  assert.match(page, /strip\.scrollLeft \+ \(chip\.left - host\.left\)/);
  assert.match(page, /centreMoveStrip\(stripRef\.current\);\s*\n\s*centreMoveStrip\(pmStripRef\.current\);/,
    'both strips re-centre: the page stays mounted under Play Mode');
  assert.match(page, /\[moveIndex, moves\.length\]/,
    'a new move and a step back both follow');
});

test('the strip geometry the phone needs', () => {
  const strip = ruleBody('.play-mode-movestrip');
  assert.match(strip, /height:\s*48px/);
  assert.match(strip, /display:\s*flex/);

  const btn = ruleBody('.pm-strip-btn');
  assert.match(btn, /width:\s*40px/, '40×40 minimum touch target');
  assert.match(btn, /height:\s*40px/);

  const row = ruleBody('.ab-movestrip');
  for (const [name, re] of [
    ['display:flex', /display:\s*flex/],
    ['flex-wrap:nowrap', /flex-wrap:\s*nowrap/],
    ['overflow-x:auto', /overflow-x:\s*auto/],
    ['white-space:nowrap', /white-space:\s*nowrap/],
    ['-webkit-overflow-scrolling:touch', /-webkit-overflow-scrolling:\s*touch/],
    ['scrollbar-width:none (hidden)', /scrollbar-width:\s*none/],
    ['scroll-snap-type:x proximity', /scroll-snap-type:\s*x proximity/],
    ['overscroll-behavior-x:contain', /overscroll-behavior-x:\s*contain/],
    ['min-width:0 (shrinks, never overflows)', /min-width:\s*0/],
  ]) assert.match(row, re, `the moves row needs ${name}`);
  assert.match(css, /\.play-mode-overlay\[data-play-mode\] \.ab-movestrip::-webkit-scrollbar\s*\{\s*display:\s*none/,
    'and no scrollbar gutter on WebKit');

  assert.match(ruleBody('.ab-mv.is-current'), /background:\s*#DBEAFE/, 'the current chip has the subtle selected background');
  assert.match(ruleBody('.ab-mvnum'), /font:\s*400 0\.62rem/, 'the move number is smaller');
  assert.match(ruleBody('.ab-mvnum'), /color:\s*var\(--ivory-500\)/, 'and grey');
});

test('the page keeps its own strip rules untouched', () => {
  /* The overlay is portalled onto the body, so it can never inherit the
     `.ab-root …` rules in the page's <style> block — which is exactly why the
     overlay carries its own copy above. Both must still exist. */
  assert.match(page, /\.ab-root\.ab-root \.ab-movestrip\{/);
  assert.match(css, /\.play-mode-overlay\[data-play-mode\] \.ab-movestrip \{/);
});
