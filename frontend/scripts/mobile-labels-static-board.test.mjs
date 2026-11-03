import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Two mobile contracts.
 *
 * 1. The Live Classroom header and tab row: a control's WORD has to survive being
 *    tapped. The label used to vanish for two different reasons — an active chip
 *    repainted by a more-specific hover rule, and a fixed-width grid cell that
 *    ellipsised the text — so both are pinned here, along with the text the tabs
 *    are meant to read.
 * 2. Play Mode at phone widths: the board must land at its size and stay there.
 *    No entrance scale, no measured-after-paint resize, no re-fit triggered by the
 *    panel above it changing height.
 */

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('src/index.css');
const panel = read('src/components/liveclass/ChatPanel.jsx');
const room = read('src/pages/LiveClassroom.jsx');
const ab = read('src/pages/AnalysisBoard.jsx');

/* rule(i, anchor) -> the CSS block that starts at `anchor`, brace to brace. */
const rule = (anchor) => {
  const i = css.indexOf(anchor);
  assert.ok(i >= 0, `the stylesheet needs a rule starting with ${JSON.stringify(anchor)}`);
  return css.slice(i, css.indexOf('}', i) + 1);
};

/* The tab bar: the chip row inside the panel heading. */
const modesStart = panel.indexOf('className="live-chat-modes"');
const bar = panel.slice(modesStart, panel.indexOf('</div>', modesStart));

/* The header action row of the classroom page. */
const headerStart = room.indexOf('className="live-room-header-right"');
const header = room.slice(headerStart, room.indexOf('</header>', headerStart));

/* The rule that paints an active chip, with every state selector folded in. */
const activeStart = css.indexOf('.live-room .live-chat-panel .live-chip-on,');
const activeBlock = css.slice(activeStart, css.indexOf('}', css.indexOf('box-shadow', activeStart)));

test('an active tab chip is blue-with-white-ink in every interaction state', () => {
  for (const state of [':hover', ':focus', ':focus-visible', ':active'])
    assert.ok(activeBlock.includes(`.live-chip-on${state}`), `the active chip needs a ${state} rule`);
  assert.match(activeBlock, /background: #2563eb !important/, 'stays filled blue');
  assert.match(activeBlock, /color: #ffffff !important/, 'keeps white ink on the blue');
  assert.match(activeBlock, /font-weight: 600/, 'reads as the selected tab');
});

test('the white hover wash cannot repaint the active chip', () => {
  const hover = rule('.live-chat-panel .live-chip:not(.live-chip-on):hover');
  assert.match(hover, /background: rgba\(255, 255, 255/, 'inactive chips still get the wash');
});

test('the app-wide black-ink readability pass leaves white-on-blue labels alone', () => {
  const start = css.indexOf('.cp-ink-all .live-chip-on,');
  const carve = css.slice(start, css.indexOf('}', css.indexOf('.cp-ink-all .app-btn--danger :is', start)));
  assert.match(carve, /color: #ffffff !important/, 'active chips and filled buttons keep white ink');
  assert.ok(carve.includes('.live-tool-label'), 'board-tool labels under the chip');
  assert.ok(carve.includes('.app-btn__label'), 'Button component labels');
});

test('the mobile tab row is a scrolling strip, not an equal-width grid', () => {
  const modes = rule('.live-chat-modes {\n    display: flex;');
  assert.match(modes, /flex-wrap: nowrap/, 'one row');
  assert.match(modes, /gap: 8px/, 'the 8px gutter');
  assert.match(modes, /overflow-x: auto/, 'extra tabs scroll sideways');
  assert.match(modes, /scrollbar-width: none/, 'without a bar eating the row');
  assert.match(css, /\.live-chat-modes::-webkit-scrollbar \{ display: none; \}/);
  assert.doesNotMatch(modes, /grid-auto-columns/, 'no equal-width cells to squeeze a label');

  const chip = rule('.live-chat-modes .live-chip {\n    flex: 0 0 auto;');
  assert.match(chip, /min-width: fit-content/, 'a tab is at least as wide as its own label');
  assert.match(chip, /white-space: nowrap/, 'the label stays on one line');
  assert.match(chip, /padding: 10px 14px/, 'with the specified padding');
  assert.match(chip, /min-height: 44px/, 'and a touch-sized target');
  assert.doesNotMatch(chip, /overflow: hidden|text-overflow: ellipsis/, 'nothing to ellipsise a label with');
});

test('the connection text is never hidden on a phone', () => {
  assert.doesNotMatch(css, /\.live-conn-text[^{}]*\{[^{}]*display: none/,
    'the live chip keeps its word at every width');
});

test('a header control cannot collapse to icon-only', () => {
  const start = css.indexOf('.live-room .live-room-header-right .live-chip,');
  const pill = css.slice(start, css.indexOf('}', css.indexOf('.live-rail-toggle {', start)));
  assert.match(pill, /min-width: 44px/, 'a floor to sit on');
  assert.match(pill, /flex: 0 0 auto/, 'the header never squeezes it');
  assert.match(pill, /white-space: nowrap/, 'and its label never wraps away');
});

test('the tabs read Chat, Moves, Leaderboard, Students with the count', () => {
  for (const label of ['💬 Chat', '♞ Moves', '🏆 Leaderboard', '👥 Students {inRoom.length}'])
    assert.ok(bar.includes(label), `the tab bar needs the label ${label}`);
  assert.doesNotMatch(bar, /Standings/, 'the old half-name is gone');
  /* Every chip in the bar, including the two the coach sees, shows a word —
     an icon-only tab is what the page used to fall back to. */
  for (const chip of bar.split('<button').slice(1))
    assert.match(chip.slice(0, chip.indexOf('</button>')), /[A-Za-z]{3}/, 'a label, not just a glyph');
});

test('no tab label depends on which tab is active', () => {
  /* With the class names taken out, nothing in the bar may still branch on the
     active tab — that is how a label ends up rendered only when NOT selected. */
  const withoutClasses = bar.replace(/className=\{`[^`]*`\}/g, 'className={...}');
  assert.doesNotMatch(withoutClasses, /activeTab/, 'selection changes paint, never content');
});

test('every header button carries a word, on screen and for a reader', () => {
  assert.ok(header.includes('👥 Students {inRoom.length}'), 'the room count is labelled');
  assert.ok(header.includes('⋯ More'), 'the overflow button is labelled');
  assert.match(header, /aria-label="More classroom options"/);
  assert.match(header, /\{railOpen \? '» Hide' : '« Panel'\}/, 'the panel toggle is labelled in both states');
  assert.match(header, /aria-label=\{railOpen \? 'Hide the side panel' : 'Show the side panel'\}/);
  assert.match(header, /▶ Open Video/, 'the video button keeps its words');
});

test('nothing squeezes a chip back to its glyph at a narrower phone', () => {
  /* The tab row is allowed one layout owner. A second, more-specific mobile block
     used to sit at max-width 900 and set `flex-shrink: 0; padding: 6px 10px`,
     which out-specified the strip and ellipsised labels on a 360px screen. */
  assert.doesNotMatch(css, /\.live-room \.live-chat-(modes|panel) \.live-chip[^{]*\{[^}]*flex-shrink/,
    'no mobile rule may shrink a tab against the strip');
});

test('the Play Mode overlay fades in without scaling the board', () => {
  const kfStart = css.indexOf('@keyframes play-mode-in');
  const kf = css.slice(kfStart, css.indexOf('}', css.indexOf('to', kfStart)));
  assert.doesNotMatch(kf, /transform|scale/, 'no grow-on-open — that read as a board shake');
  assert.match(kf, /from \{ opacity: 0; \}/, 'opacity only');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.play-mode-overlay \{ animation: none; \}/,
    'and nothing at all for reduced motion');
});

test('the mobile Play Mode panel reserves its height so the board keeps its size', () => {
  const scroll = rule('.play-mode-panel-scroll {\n    flex: 0 0 auto;');
  assert.match(scroll, /height: 38dvh/, 'a viewport-true height (the URL bar is not content)');

  const area = rule('.play-mode-board-area { order: -1; flex: 1 1 0;');
  assert.match(area, /min-height: 0/, 'and it can shrink to what is left');
  assert.doesNotMatch(css, /\.play-mode-board-area \{[^{}]*flex: 1 1 auto/,
    'a content basis is the feedback loop that jumped the board twice');
});

test('the Play Mode board is measured before paint and only re-fits on a real change', () => {
  const measureIdx = ab.indexOf('const el = pmAreaRef.current;');
  assert.ok(measureIdx > 0, 'the overlay area is measured');
  const head = ab.slice(Math.max(0, measureIdx - 900), measureIdx);
  assert.match(head, /useLayoutEffect\(\(\) => \{/, 'measured before the first paint');
  assert.match(ab, /Math\.abs\(prev\.w - w\) <= 2 && Math\.abs\(prev\.h - h\) <= 2/,
    'a sub-pixel reading keeps the previous size instead of rebuilding the board');
  assert.match(ab, /if \(w <= 0 \|\| h <= 0\) return;/,
    'a collapsed reading is not a size and cannot drop the board onto the fallback');
  assert.doesNotMatch(ab, /setPmSize\(\{ w: Math\.floor\(w\), h: Math\.floor\(h\) \}\)/,
    'the unconditional setter is gone');
});
