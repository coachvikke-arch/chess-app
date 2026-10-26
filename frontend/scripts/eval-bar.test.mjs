// Regression tests for the evaluation bar: src/lib/evalDisplay.ts plus the
// wiring in pages/GameReview.jsx (review bar) and components/GameReplay.tsx
// (GM replay bar). Run with: node --test (from frontend/)
//
// Nothing here touches engine output, CPL or classification: the helpers only
// read centipawns and produce a display string plus a 0-100 White share.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../src/lib/evalDisplay.ts', import.meta.url);
const REVIEW_SRC = new URL('../src/pages/GameReview.jsx', import.meta.url);
const REPLAY_SRC = new URL('../src/components/GameReplay.tsx', import.meta.url);
const CSS_SRC = new URL('../src/index.css', import.meta.url);

/** evalDisplay is TypeScript with no imports, so a straight transpile is
 *  enough — no browser globals to strip. */
let mod;
before(async () => {
  const { code } = await transform(readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const file = join(mkdtempSync(join(tmpdir(), 'eval-bar-')), 'evalDisplay.mjs');
  writeFileSync(file, code);
  mod = await import(pathToFileURL(file).href);
});

const REVIEW = readFileSync(REVIEW_SRC, 'utf8');
const REPLAY = readFileSync(REPLAY_SRC, 'utf8');
const CSS = readFileSync(CSS_SRC, 'utf8');

/* ── 1. score display: centipawns → pawn units, exactly once ─────────────── */
test('centipawns convert to pawn units exactly once for display', () => {
  assert.equal(mod.formatEvalScore(-126), '-1.26');
  assert.equal(mod.formatEvalScore(126), '+1.26');
  assert.equal(mod.formatEvalScore(-50), '-0.50');
  assert.equal(mod.formatEvalScore(0), '0.00');
  assert.equal(mod.formatEvalScore(75), '+0.75');
  assert.equal(mod.formatEvalScore(500), '+5.00');
  /* One conversion, never two: a pawn value fed in again would print -1.26 as
     -0.01, and a centipawn value printed raw would print 126.00. */
  assert.notEqual(mod.formatEvalScore(-126), '-126.00');
  assert.notEqual(mod.formatEvalScore(-126), '-0.01');
});

test('an unknown evaluation shows a dash, never a fake number', () => {
  assert.equal(mod.formatEvalScore(null), '—');
  assert.equal(mod.formatEvalScore(undefined), '—');
  assert.equal(mod.formatEvalScore(NaN), '—');
});

/* ── mate scores stay separate from centipawns ───────────────────────────── */
test('mate is displayed as mate, not as an ordinary score', () => {
  assert.equal(mod.formatEvalScore(10000, 3), '+M3');
  assert.equal(mod.formatEvalScore(-10000, -2), '-M2');
  assert.equal(mod.formatEvalScore(-10000, null), '-M');   // distance unknown
  assert.equal(mod.formatEvalScore(99900, 4), '+M4');      // legacy mate-scale cp
  assert.notEqual(mod.formatEvalScore(10000, 3), '+100.00');
});

test('a forced mate parks the bar on the mating side', () => {
  assert.ok(mod.evalBarPercent(10000, 3) >= 95, 'White mates → bar to White');
  assert.ok(mod.evalBarPercent(-10000, -3) <= 5, 'Black mates → bar to Black');
  assert.ok(mod.evalBarPercent(null, -5) <= 5, 'mate without a centipawn value');
  assert.ok(mod.evalBarPercent(99900, 4) >= 95, 'GM replay mate scale');
  assert.ok(mod.evalBarPercent(-99900, -4) <= 5, 'GM replay -M4');
});

/* ── bar position and colour proportions ─────────────────────────────────── */
test('zero evaluation is exactly 50/50', () => {
  assert.equal(mod.evalBarPercent(0), 50);
  assert.equal(mod.evalBarPercent(null), 50, 'no eval yet reads as level');
});

test('negative eval moves the bar toward Black, positive toward White', () => {
  const black = mod.evalBarPercent(-100);
  const white = mod.evalBarPercent(100);
  assert.ok(black < 50, '−1.00 must favour Black, got ' + black);
  assert.ok(white > 50, '+1.00 must favour White, got ' + white);
});

test('the documented steps move monotonically, −5.00 heavily Black … +5.00 heavily White', () => {
  const p = (cp) => mod.evalBarPercent(cp);
  assert.ok(p(-500) < p(-200));
  assert.ok(p(-200) < p(-100));
  assert.ok(p(-100) < p(0));
  assert.ok(p(0) < p(100));
  assert.ok(p(100) < p(200));
  assert.ok(p(200) < p(500));
});

test('the mapping is bounded — big scores approach the ends without leaving the bar', () => {
  for (const cp of [1000, 5000, 100000, 1e9]) {
    const hi = mod.evalBarPercent(cp);
    assert.ok(hi <= 100 && hi >= 99, cp + ' must clamp near White, got ' + hi);
    const lo = mod.evalBarPercent(-cp);
    assert.ok(lo <= 1 && lo >= 0, (-cp) + ' must clamp near Black, got ' + lo);
  }
});

test('every centipawn value maps to a valid 0–100 split, deterministically', () => {
  for (const cp of [-10000, -5000, -1000, -100, -50, 0, 50, 100, 1000, 5000, 10000]) {
    const pct = mod.evalBarPercent(cp);
    assert.ok(pct >= 0 && pct <= 100, cp + ' → ' + pct + ' escaped the bar');
    assert.equal(pct, mod.evalBarPercent(cp), 'the split must be deterministic');
  }
});

test('stepping between positions recomputes the split instead of keeping the last one', () => {
  const split = (cp) => {
    const white = mod.evalBarPercent(cp);
    return { white, black: 100 - white };
  };
  const first = split(-300);
  const second = split(300);
  assert.notEqual(first.white, second.white, 'the split must change with the eval');
});

/* ── label placement tests ── */
test('the label sits on the side of the leader', () => {
  const white = mod.evalLabelPlacement({ cp: 300, orientation: 'white', barHeightPx: 360 });
  assert.equal(white.onWhite, true, 'White is better → the label is on the White side');
  const black = mod.evalLabelPlacement({ cp: -300, orientation: 'white', barHeightPx: 360 });
  assert.equal(black.onWhite, false, 'Black is better → the label is on the Black side');
  /* A level position reads as White's side (the label is dark on the white fill). */
  const level = mod.evalLabelPlacement({ cp: 0, orientation: 'white', barHeightPx: 360 });
  assert.equal(level.onWhite, true);
});

test('flipping the board flips which side the label hangs on', () => {
  const up = mod.evalLabelPlacement({ cp: 300, orientation: 'white', barHeightPx: 360 });
  const down = mod.evalLabelPlacement({ cp: 300, orientation: 'black', barHeightPx: 360 });
  assert.equal(up.onWhite, down.onWhite, 'the leader is the same either way');
  assert.notEqual(up.above, down.above, 'the White half swaps ends, so the label must too');
  assert.equal(up.barPct, 100 - down.barPct, 'the bar mirrors when the board is flipped');
});

test('the label never leaves the bar', () => {
  for (const cp of [-10000, -1000, -100, 0, 100, 1000, 10000]) {
    for (const orientation of ['white', 'black']) {
      for (const barHeightPx of [160, 360, 700]) {
        const p = mod.evalLabelPlacement({ cp, orientation, barHeightPx });
        assert.ok(p.splitPct >= 0 && p.splitPct <= 100, cp + ' → ' + p.splitPct + ' escaped the bar');
        const pad = Math.min(18, (18 / barHeightPx) * 100);
        assert.ok(p.splitPct >= pad && p.splitPct <= 100 - pad,
          cp + ' at ' + orientation + '/' + barHeightPx + 'px: split ' + p.splitPct + '% too close to an edge');
      }
    }
  }
});

test('a mate parks the label on the mating side', () => {
  const whiteMate = mod.evalLabelPlacement({ cp: 10000, mate: 3, orientation: 'white', barHeightPx: 360 });
  assert.equal(whiteMate.text, 'M3');
  assert.equal(whiteMate.onWhite, true);
  const blackMate = mod.evalLabelPlacement({ cp: -10000, mate: -3, orientation: 'white', barHeightPx: 360 });
  assert.equal(blackMate.text, '-M3');
  assert.equal(blackMate.onWhite, false);
});

/* ── GameReview wiring tests ── */
test('the stack does not clip the label', () => {
  assert.match(CSS, /\.eval-bar-stack \{[^}]*position:\s*relative/);
  assert.match(CSS, /\.eval-bar-stack \{[^}]*height:\s*100%/);
  assert.doesNotMatch(CSS, /\.eval-bar-stack \{[^}]*overflow:\s*hidden/,
    'the stack must not clip the label');
});

test('GameReview renders the label on the bar, riding the split', () => {
  /* The bar and its label are produced by CanonicalEvalBar; the page passes
     cp/mate/orientation/height through. The label logic lives inside that
     component — verify it there instead of in the page source. */
  assert.match(REVIEW, /<CanonicalEvalBar\s+cp=\{evalCp\}\s+mate=\{evalMate\}\s+orientation=\{orientation\}\s+height=\{boardW\}\s*\/>/);
  const CANONICAL_SRC = new URL('../src/components/chess/CanonicalEvalBar.jsx', import.meta.url);
  const CANONICAL = readFileSync(CANONICAL_SRC, 'utf8');
  assert.ok(CANONICAL.includes('evalLabel'), 'CanonicalEvalBar renders the eval label');
  assert.ok(CANONICAL.includes('is-dark'), 'CanonicalEvalBar applies dark-on-white label styling');
});

test('GameReview passes centipawns, not pawns, into the bar', () => {
  assert.match(REVIEW, /<CanonicalEvalBar\s+cp=\{evalCp\}\s+mate=\{evalMate\}\s+orientation=\{orientation\}\s+height=\{boardW\}\s*\/>/);
  assert.ok(!REVIEW.includes('Math.atan('), 'the old clamped atan mapping must be gone');
  assert.ok(!REVIEW.includes('staticPawns'), 'pawns must not be carried in a variable of their own');
  /* The reviewed row stores CENTIPAWNS (`played`) and a signed mate distance
     (`playedMate`), both mover-perspective; the helper does the conversion. */
  assert.match(REVIEW, /toWhite\(staticRow\?.played\)/);
  assert.match(REVIEW, /toWhite\(staticRow\?.playedMate\)/);
  assert.ok(!/played\s*\/\s*100/.test(REVIEW), 'no second conversion in the page');
});

test('the board is centred and the eval bar keeps its own space beside it', () => {
  /* The board is the centred thing; the bar (the "pipe") is lifted out of the
     flow so it cannot push the board off centre, and it keeps a gap of its own
     between it and the board. */
  assert.match(CSS, /\.gr-board-row \{[^}]*justify-content:\s*center/,
    'the board row must centre its content');
  assert.match(CSS, /\.gr-board-glow \{[^}]*width:\s*100%/,
    'the glow box has to be full width, or centring has nothing to work with');
  assert.match(CSS, /\.gr-board-slot \{[^}]*position:\s*relative/);
  assert.match(CSS, /\.gr-board-slot \.gr-eval \{[^}]*position:\s*absolute/,
    'the bar must not take flow space beside the board');
  assert.match(CSS, /\.gr-board-slot \.gr-eval \{[^}]*right:\s*calc\(100% \+ 1rem\)/,
    'the bar keeps a gap of its own between it and the board');
  /* On a phone there is no room for that, so it goes back in the flow. */
  assert.match(CSS, /@media \(max-width: 767px\)[\s\S]{0,600}?\.gr-board-slot \.gr-eval \{ position: static; \}/);
  /* And the page renders the slot. */
  assert.match(REVIEW, /<div className="gr-board-slot">/);
});

test('the search depth is not shown under the bar', () => {
  /* "d18" under the eval bar was noise: the depth is still in the tooltip of
     the engine's own read-out, but it is no longer a chip of its own. */
  assert.ok(!REVIEW.includes('evalDepth'), 'evalDepth chip and its ternary are gone from GameReview');
});

test('GameReview drives both fills and the marker from that one split', () => {
  /* CanonicalEvalBar computes the split internally from cp/mate/orientation;
     the page just passes those props through. */
  assert.match(REVIEW, /<CanonicalEvalBar\s+cp=\{evalCp\}\s+mate=\{evalMate\}\s+orientation=\{orientation\}\s+height=\{boardW\}\s*\/>/);
  assert.ok(!/height:\s*'50%'/.test(REVIEW), 'no hard-coded 50/50 split');
});

/* ── GM replay wiring tests ── */
test('the GM replay bar moves its fill AND its divider with the current ply', () => {
  /* CanonicalEvalBar computes the split internally from cp/mate/orientation;
     the page just passes those props through. JSX attributes wrap across
     lines, so \s+ is used between them instead of literal spaces. */
  assert.match(REPLAY, /<CanonicalEvalBar\s+cp=\{shownEval\}\s+mate=\{currentAnalysis\?\.mateAfter\s*\?\?\s*null\}\s+orientation=\{orientation\}\s+height=\{boardWidth\}/);
  assert.ok(!/50 \+ 50 \* Math\.tanh/.test(REPLAY), 'the inline mapping moved into the helper');
  /* the graph keeps sharing the bar's scale, so curve and bar agree */
  assert.match(REPLAY, /GRAPH_SCALE_CP = EVAL_BAR_SCALE_CP/);
});

/* ── animation ── */
test('both bars animate to the new split instead of jumping or sitting still', () => {
  assert.match(CSS, /\.eval-white-fill,\s*\.eval-black-fill \{[^}]*transition: height/s);
  assert.match(CSS, /\.gm-evalbar-fill \{[^}]*transition: height/s);
  assert.match(CSS, /\.gm-evalbar-mid \{[^}]*transition: top/s);
  assert.match(CSS, /\.eval-marker \{[^}]*transition: bottom/s);
});
