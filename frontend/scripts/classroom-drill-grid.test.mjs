/**
 * The live-class drill grid lays the class out four across, and each card's
 * mini board fits the column it lands in.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `.live-drill-grid` was `repeat(auto-fill, minmax(357px, 1fr))`, so the column
 * count was whatever the leftover width happened to allow — two or three fat
 * columns on a big monitor. That is fewer students per screen than the space
 * exists for, and comparing the class is the entire purpose of this screen: who
 * finished, who is stuck on which ply, who never opened the drill.
 *
 * Going to four fixed columns then broke the card. `MiniDrillBoard` passed
 * `boardWidth={252}` — a constant chosen for the old 357px track. Four columns
 * put each track well under 252px, and the board is the one element on the card
 * that cannot shrink to fit, so it burst out of its card. A fixed number cannot
 * be right for both the column count and the viewport, so the board is measured
 * off its own element instead (see `useFittedWidthIn`).
 *
 * Run with: npm run test:class-drill-grid
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const drill = readFileSync(join(ROOT, 'src', 'components', 'liveclass', 'PuzzleDrill.jsx'), 'utf8');
const hook = readFileSync(join(ROOT, 'src', 'hooks', 'useBoardWidth.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/* Structural checks run against comment-stripped source. The rules below are
 * explained in comments that quote the very values they forbid (`357px`,
 * `boardWidth={252}`, `repeat(auto-fill`), `min-h-screen`), so an unstripped scan
 * would match this file's own explanation of the bug. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const drillCode = strip(drill);
const hookCode = strip(hook);

const rule = (sel) => {
  const i = css.indexOf(sel);
  if (i === -1) return '';
  return css.slice(i, css.indexOf('}', i));
};

test('the drill grid is four columns', () => {
  assert.match(rule('.live-drill-grid'), /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    'exactly four tracks');
  /* Fixed, not auto: an auto-fill track count silently becomes a different
     layout as the window changes, which is how the "why is this two columns on
     my monitor" bug comes back. */
  assert.doesNotMatch(rule('.live-drill-grid'), /auto-fill|auto-fit/,
    'the column count is not left to the leftover width');
});

test('the columns step down instead of squeezing four boards into a small area', () => {
  /* minmax(0, ...) is what allows the step-down to work: with the default 1fr
     minimum, a card whose move chips are wider than its track pushes the grid
     into a horizontal scrollbar rather than wrapping. */
  const steps = [...css.matchAll(/@media \(max-width: (\d+)px\) \{\s*\.live-drill-grid \{ grid-template-columns: ([^;]+); \}/g)]
    .map((m) => ({
      at: Number(m[1]),
      /* A bare `minmax(0, 1fr)` is the single-column form - written without a
         repeat(1, ...) because there is nothing to repeat. */
      cols: /repeat\((\d+),/.test(m[2]) ? Number(RegExp.$1) : 1,
      tracks: m[2],
    }));
  assert.deepEqual(
    steps.map((s) => s.cols),
    [3, 2, 1],
    'three, then two, then one',
  );
  for (const s of steps) {
    assert.match(s.tracks, /minmax\(0, 1fr\)/, `the ${s.cols}-column rule can shrink below its content`);
  }
  assert.deepEqual(
    steps.map((s) => s.at),
    [...steps.map((s) => s.at)].sort((a, b) => b - a),
    'the breakpoints are in descending order, so the widest wins on a big screen',
  );
  assert.match(rule('.live-drill-grid'), /overflow-x: hidden/, 'and nothing spills sideways either way');
});

test('the card board is measured, not a constant that only suited the old columns', () => {
  assert.match(drillCode, /useFittedWidthIn\(boardRef, \{ max: 252 \}\)/,
    'the width comes from the measuring hook, with 252 as the ceiling');
  assert.doesNotMatch(drillCode, /boardWidth=\{252\}/,
    'the fixed width that overflowed at four columns is gone');
  assert.match(drillCode, /boardWidth=\{width\}/, 'and the measured width is what the board gets');
});

test('the measuring hook reads its own element, because the column is not the viewport', () => {
  /* useFittedBoardWidth derives from window.innerWidth, which is only correct
     when the board owns the page. Here the space is a fraction of the drill
     area that changes with the column count, so the element is the source. */
  assert.match(hookCode, /const inner = el\.clientWidth/, 'the element is measured');
  assert.match(hookCode, /new ResizeObserver\(measure\)/, 'and re-measured when it changes');
  assert.match(hookCode, /ro\.observe\(el\)/, 'observing that element, not the window');
  assert.match(hookCode, /window\.addEventListener\('resize', measure\)/, 'plus a resize fallback');
  assert.match(hookCode, /ro\?\.disconnect\(\)/, 'and the observer is torn down');
});

test('the hook solves the same frame identity the other board sizers use', () => {
  /* `.rem-outer` wraps the bare square in a themed frame worth ~ 2*remC + 30px
     with remC ~ 0.082*bw, so (inner - 30) / 1.164 is the square. Kept
     identical to `useFittedBoardWidth` on purpose: two board sizers in one file
     that disagree by a few px is its own bug. */
  assert.match(hookCode, /\(inner - 30\) \/ 1\.164/, 'the frame overhead is subtracted the same way');
  const fitted = hook.match(/export function useFittedBoardWidth[\s\S]*?\n}/)[0];
  assert.match(fitted, /\/ 1\.164/, 'matching useFittedBoardWidth');
});

test('the hook has a floor, and does not loop on its own observer', () => {
  /* A floor: below it the position is too small to read, so letting the region
     overflow beats showing an unusable sliver. */
  assert.match(hookCode, /Math\.max\(min,/, 'the size is floored');
  assert.match(hookCode, /Math\.min\(max,/, 'and capped');
  /* Without the >= 1px guard the ResizeObserver re-runs this effect forever
     without settling, because every measure commits the same float. */
  assert.match(hookCode, /Math\.abs\(prev - next\) >= 1/, 'only a real change is committed');
});

test('every MiniDrillBoard hook runs before the early return', () => {
  /* Rules of hooks: `if (!fen) return null` sat between the hooks and nothing
     before, so adding the measuring hook above it is safe. Pinned because the
     next person adds a hook below that guard and React throws. */
  const body = drillCode.slice(drillCode.indexOf('function MiniDrillBoard'));
  const guardAt = body.indexOf('if (!fen) return null;');
  const hookAt = body.indexOf('useFittedWidthIn(boardRef');
  assert.ok(hookAt > -1, 'the measuring hook is called');
  assert.ok(guardAt > hookAt, 'and it runs before the early return');
  for (const h of ['useRef(null)', 'useMemo(']) {
    const at = body.indexOf(h);
    assert.ok(at > -1 && at < guardAt, `${h} is called before the early return`);
  }
});

test('the student keeps their own card, out of the instructor grid', () => {
  /* The four-column grid is the instructor's class view. The student's own
     result card used to be rendered in `.live-drill-own`; it now rides on the
     shared board's drill strip (`StudentDrillStatus`), which is a different
     place but the same rule — the student is never handed three empty columns
     beside their own board. */
  assert.match(drillCode, /function StudentDrillStatus\(/, 'the student still has their own card component');
  /* Bound to the grid's own element rather than a fixed window: a magic
     character count silently starts matching the function that follows it. */
  const gridOpen = drillCode.indexOf('className="live-drill-grid"');
  const gridBlock = drillCode.slice(gridOpen, drillCode.indexOf('</div>', gridOpen));
  assert.doesNotMatch(gridBlock, /StudentDrillStatus/, 'and it is not inside the grid');
  /* It must actually be reachable from the board, not just defined. */
  assert.match(drillCode, /<SharedChessBoard[\s\S]{0,200}drillStatus=\{studentDrillStatus\}/);
});