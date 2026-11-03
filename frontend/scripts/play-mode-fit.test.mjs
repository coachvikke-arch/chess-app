// Regression tests for the Play Arena (Play Mode) board auto-fit —
//   run with: node --test scripts/play-mode-fit.test.mjs   (from frontend/)
//
// The Play Arena overlay is a 320px side panel plus a square board area, and the
// board must fill that area exactly: any smaller and it is letterboxed, any
// larger and the overlay's `overflow: hidden` cuts the bottom off.
//
// Two bugs lived here, and both are about measuring the wrong box:
//
//   1. The measurement used getBoundingClientRect(), which returns the PADDED
//      border box. The element's padding differs per breakpoint (3.5rem top on
//      desktop for the fixed ✕ button, 0.75rem all round on mobile), so the fit
//      was consistently over-budget and clipped the board.
//   2. The fit budgeted the play area and then let ChessBoard's themed frame hang
//      OUTSIDE it (`boardWidth + 2*remC + 26`), so a framed board overflowed the
//      area by the band on both sides and the bottom got cut off — while the same
//      board with the frame off sat smaller than its space. The overlay then had
//      to know whether a frame was being drawn at all (`showPmFrame`), which is
//      how the frame setting leaked into page layout.
//
// The overlay now measures the CONTENT box and hands that whole space to
// ChessBoard as `outerWidth`; ChessBoard carves the frame out of it. The fit is a
// plain clamp and the page never reads the frame preference. These assert that,
// against the real source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const boardSrc = readFileSync(join(ROOT, 'src', 'components', 'ChessBoard.jsx'), 'utf8');
const frameSrc = readFileSync(join(ROOT, 'src', 'components', 'BoardFrame.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

const fitStart = src.indexOf('const pmBoardOuter');
assert.notEqual(fitStart, -1, 'pmBoardOuter must exist');
const fit = src.slice(fitStart, src.indexOf('})();', fitStart) + 3);

test('the Play Arena board is measured from the board-area element', () => {
  assert.match(src, /const pmAreaRef\s*=\s*useRef\(null\)/,
    'the board area must be measured via a ref');
  assert.match(src, /className="play-mode-board-area" ref=\{pmAreaRef\}/,
    'the ref must be on the board-area element');
});

test('the fit measures the CONTENT box, not the padded border box', () => {
  /* getBoundingClientRect() includes padding, and this element's padding
     changes at the mobile breakpoint. Reading the resolved padding makes the
     measurement exact at both sizes instead of assuming one of them. */
  assert.match(src, /el\.clientWidth - px\(cs\.paddingLeft\) - px\(cs\.paddingRight\)/,
    'width must subtract the resolved horizontal padding');
  assert.match(src, /el\.clientHeight - px\(cs\.paddingTop\) - px\(cs\.paddingBottom\)/,
    'height must subtract the resolved vertical padding');
  assert.match(src, /getComputedStyle\(el\)/,
    'the padding must be read from the computed style, not hard-coded');
  /* the measuring effect must not go back to the padded rect */
  const measureStart = src.indexOf('const pmAreaRef');
  const measure = src.slice(measureStart, measureStart + 1400);
  assert.ok(!/getBoundingClientRect/.test(measure),
    'a getBoundingClientRect fit measures the padded box and clips the board');
});

test('the frame is kept, because it carries the coordinate labels', () => {
  /* Tempting "fix" for the size: force `frameless` on the Play Arena board. That
     would silently delete the a-h / 1-8 labels, because ChessBoard's frameless
     branch returns before BoardFrame ever renders them. */
  assert.match(boardSrc, /if \(!showFrame\) \{[\s\S]{0,200}?return \(/,
    'the frameless branch returns early in ChessBoard');
  const framelessReturn = boardSrc.slice(boardSrc.indexOf('if (!showFrame) {'), boardSrc.indexOf('<BoardFrame'));
  assert.ok(!/remCoords|BoardFrame/.test(framelessReturn),
    'the frameless branch must be the one that skips the frame and its labels');
  assert.match(frameSrc, /className="rem-lab"/, 'the coordinate labels live in BoardFrame');
  assert.match(frameSrc, /<div className="rem-content">/, 'inside the framed markup');
  /* so the Play Arena board must not be forced frameless */
  assert.ok(!/className="play-mode-board-area"[\s\S]{0,900}frameless/.test(src),
    'Play Arena must not force frameless — it would drop the coordinates');
});

test('the fit hands over the whole area and reserves nothing for the frame', () => {
  /* The frame now sits inside the number, so the overlay has no band arithmetic
     left to do and must not read the frame preference either. */
  assert.doesNotMatch(src, /showPmFrame|pmBoardWidth/, 'the old per-page frame reserve is gone');
  assert.doesNotMatch(fit, /remC|frameBandFor|framedOuterFor/, 'no band arithmetic in the fit');
  assert.match(fit, /const budget = Math\.min\(availW, availH\);/,
    'the budget is the tightest of the area dimensions');
  assert.match(fit, /Math\.max\(160, budget - 4\)/,
    'the board fills the area with only a 4px edge clearance');
  assert.match(src, /<ArenaBoard[\s\S]{0,400}outerWidth=\{boardOuter\}/,
    'the page board is sized by its outer box too');
  assert.match(src, /outerWidth=\{pmBoardOuter\}/, 'and so is the Play Mode board');
});

test('the framed board never leaves the box the fit handed it', async () => {
  /* The payoff, run for real: across the actual breakpoints and both frame
     states, the OUTER footprint of what ChessBoard draws has to fit the measured
     area. This is what "the bottom is not cut off" actually means — and it is the
     same number with the frame on as off, which is the other half of the brief. */
  const { squaresForOuter, framedOuterFor } = await import('../src/utils/boardFrame.js');
  const viewports = [
    { w: 1280 - 320, h: 800 },   // laptop, 320px overlay panel
    { w: 1920 - 320, h: 1080 },  // desktop
    { w: 768, h: 1024 },         // tablet portrait — the panel drops below
    { w: 390, h: 844 },          // phone
    { w: 360, h: 640 },          // narrowest supported phone
  ];
  for (const vp of viewports) {
    const area = Math.min(vp.w, vp.h);
    const outer = Math.round(Math.max(160, Math.min(area, vp.h) - 4));
    const squares = squaresForOuter(outer);
    assert.ok(framedOuterFor(squares) <= outer,
      `framed footprint ${framedOuterFor(squares)} must fit the ${outer}px box (area ${area})`);
    assert.ok(outer <= area, `${outer} must fit the measured area (${area})`);
    assert.ok(squares >= 110 || vp.w < 500,
      'only a phone-sized area may drop below the label legibility floor');
  }
});

test('the board-area element is a flex box that centres the board', () => {
  const i = css.indexOf('.play-mode-board-area {');
  assert.notEqual(i, -1, '.play-mode-board-area must exist');
  const rule = css.slice(i, css.indexOf('}', i));
  assert.match(rule, /flex:\s*1/, 'the board area must grow to fill the overlay');
  assert.match(rule, /align-items:\s*center/, 'the board must be centred vertically');
  assert.match(rule, /justify-content:\s*center/, 'the board must be centred horizontally');
});
