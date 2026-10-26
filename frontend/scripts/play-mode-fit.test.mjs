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
//   2. ChessBoard is rendered here WITHOUT a `frameless` prop, so it follows the
//      user's saved boardFrame preference. The ornate marble frame renders
//      `boardWidth + 2*remC + 26`, so a fit that budgeted only for boardWidth
//      overflowed by the width of the band on both sides and the height of it at
//      the bottom — which is what cut the board off.
//
// The fit therefore measures the CONTENT box and reserves the frame the board
// will actually draw. These assert both, against the real source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const boardSrc = readFileSync(join(ROOT, 'src', 'components', 'ChessBoard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

const fitStart = src.indexOf('const pmBoardWidth');
assert.notEqual(fitStart, -1, 'pmBoardWidth must exist');
const fit = src.slice(fitStart, src.indexOf('})();', fitStart));

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
     branch returns before rendering `remCoords`. The fit must reserve the frame
     instead of removing it. */
  assert.match(boardSrc, /if \(!showFrame\) \{[\s\S]{0,400}?return \(/,
    'the frameless branch returns early in ChessBoard');
  const framelessReturn = boardSrc.slice(boardSrc.indexOf('if (!showFrame) {'));
  assert.ok(!/remCoords/.test(framelessReturn.slice(0, 400)),
    'the frameless branch must be the one that skips remCoords');
  assert.match(boardSrc, /\{remCoords\}[\s\S]{0,80}<div className="rem-content">/,
    'the coordinate labels live inside the framed branch');
  /* so the Play Arena board must not be forced frameless */
  assert.ok(!/className="play-mode-board-area"[\s\S]{0,600}frameless/.test(src),
    'Play Arena must not force frameless — it would drop the coordinates');
  assert.match(fit, /if \(!showPmFrame\)/,
    'the fit still honours the user preference instead of overriding it');
});

test('the fit reserves the ornate frame when the user has it enabled', () => {
  /* ChessBoard gets no `frameless` prop here, so it honours the saved
     boardFrame preference. The frame adds 2*remC + 26 around the board; without
     that reserve the board overflows and the bottom is clipped. */
  assert.match(boardSrc, /frameless === null \? boardFrame : !frameless/,
    'ChessBoard falls back to the saved boardFrame preference when frameless is null');
  assert.match(src, /const showPmFrame = !!boardFrame/,
    'the fit must read the same preference ChessBoard will use');
  assert.match(fit, /if \(!showPmFrame\)/,
    'the frameless branch must be taken only when the frame is off');
  assert.match(fit, /2 \* remC\(w\) \+ 26/,
    'the framed branch must reserve the frame the board really adds');
  assert.match(fit, /Math\.min\(46, Math\.max\(20, Math\.round\(w \* 0\.082\)\)\)/,
    'remC must use the same clamp as ChessBoard, or the reserve is wrong');
});

test('the frame-free fit fills the area with only a hair of edge clearance', () => {
  /* With no frame the board IS the square, so it must take the whole area less a
     few px — the earlier blanket frame subtraction is what letterboxed it. */
  assert.match(fit, /const budget = Math\.min\(availW, availH\);/,
    'the budget is the tightest of the area dimensions');
  assert.match(fit, /Math\.max\(160, budget - 4\)/,
    'the frameless board fills the area with only a 4px edge clearance');
});

test('the framed fit never returns a board wider than the area', () => {
  /* Replicates the fixed-point solve across the real breakpoints and both frame
     states, asserting the OUTER width (board + frame) fits the area. This is the
     payoff assertion: it is what "the bottom is not cut off" actually means. */
  const remC = (w) => Math.min(46, Math.max(20, Math.round(w * 0.082)));
  const solve = (availW, availH, framed) => {
    const budget = Math.min(availW, availH);
    if (!framed) return Math.max(160, budget - 4);
    let w = budget;
    for (let i = 0; i < 8; i += 1) {
      const outer = w + 2 * remC(w) + 26;
      const next = budget - (outer - w);
      if (Math.abs(next - w) < 1) { w = next; break; }
      w = next;
    }
    return Math.max(160, Math.round(w));
  };

  /* 1280x800 laptop, 1920x1080 desktop, 768x1024 tablet portrait, 390x844 phone */
  const viewports = [
    { w: 1280 - 320, h: 800 },
    { w: 1920 - 320, h: 1080 },
    { w: 768, h: 1024 },
    { w: 390, h: 844 },
  ];

  for (const vp of viewports) {
    for (const framed of [true, false]) {
      const board = solve(vp.w, vp.h, framed);
      const outer = framed ? board + 2 * remC(board) + 26 : board + 4;
      assert.ok(outer <= Math.min(vp.w, vp.h) + 1,
        `board+frame (${outer}) must fit the area (${Math.min(vp.w, vp.h)}) framed=${framed}`);
      /* and it must still be a real, usable board */
      assert.ok(board >= 160, `board must keep its 160px floor, got ${board}`);
    }
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