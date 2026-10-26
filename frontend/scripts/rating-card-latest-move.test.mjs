/* The Rapid Rating & Badge card's data source and rendering.
 *
 * Run: node --test scripts/rating-card-latest-move.test.mjs
 *
 * THE BUG BEING PINNED
 * --------------------
 * The card showed a delta next to the rating that was computed as
 *
 *     recent.reduce((s, r) => s + r.rating_change, 0)
 *
 * i.e. the NET of several Rapid games, which is not "the latest rating move" at
 * all. A single win after two losses rendered as a loss, and a loss after a run
 * of wins rendered as a rise. The task called this out with a real number: 986
 * shown with a misleading -14 that was the sum of the window, not the last game.
 *
 * These tests cover two things:
 *   1. BACKEND (test-rating-card-latest-move.js) - the profile response now
 *      carries the authoritative latest Rapid transition and the recent Rapid
 *      rows, both Rapid-only and both from this student's own rows.
 *   2. FRONTEND (this file) - the card consumes that transition and never
 *      re-derives a rating, and renders the form squares from the server rows. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const card = readFileSync(join(root, 'src', 'components', 'RatingCard.jsx'), 'utf8');
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');

/* `gameOutcome` lives in charts.jsx, a .jsx module node cannot import directly.
   It is pure JS with no JSX, so extracting just that function and evaluating it
   exercises the REAL function the card calls, not a copy of it. */
const chartsSrc = readFileSync(join(root, 'src', 'utils', 'charts.jsx'), 'utf8');
const fnSrc = chartsSrc.slice(
  chartsSrc.indexOf('/**\n * Derive a single W / D / L outcome'),
);
const gameOutcomeSrc = fnSrc.slice(
  0,
  fnSrc.indexOf('\n}\n') + 3,
).replace('export function gameOutcome', 'function gameOutcome');
const { gameOutcome } = await import(
  `data:text/javascript,${encodeURIComponent(`${gameOutcomeSrc}\nexport { gameOutcome };`)}`,
);

/* The component's own executable code, with comments stripped. Used by the
   source assertions below so a code sample inside an explanatory comment cannot
   make a "this must not be present" check pass or fail spuriously.

   NB: JSX is intentionally NOT stripped, so a multi-line JSX expression keeps
   its newlines and regexes anchored on it stay reliable. */
const code = card.replace(/\/\*[\s\S]*?\*\//g, '');

test('the delta comes from the server transition, not a sum over recent rows', () => {
  assert.match(card, /data\.latestRapid/,
    'the card must read the server-supplied latestRapid transition');
  /* The old net-of-window computation must be gone from the executable code. */
  assert.doesNotMatch(code, /reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>[^\n]*rating_change/,
    'the card must NOT sum rating_change across recent rows');
  assert.doesNotMatch(code, /data\.rapidHistory/,
    'the card must not read the raw rapid history list for its delta');
  /* It reads the change off the single latest row. */
  assert.match(code, /Number\(latest\.ratingChange\)/,
    'the displayed change must come from latestRapid.ratingChange');
});

test('the delta is NOT derived from peak, starting rating or another category', () => {
  /* No arithmetic against peakRating anywhere. */
  assert.doesNotMatch(card, /shownRating\s*-\s*shownPeak|shownPeak\s*-\s*shownRating|currentRating\s*-\s*peak/,
    'the delta must not be current - peak');
  assert.doesNotMatch(card, /STARTING_RATING|1000\s*-|\b986\b|\b972\b/,
    'no hardcoded rating fixture values may appear in the component');
  /* No cross-category reads feed the indicator. */
  assert.doesNotMatch(card, /latest\w*\s*=\s*data\.(blitz|bullet|classical)/i,
    'the Rapid delta must not read another time control');
});

test('no Elo is recalculated in the component', () => {
  assert.doesNotMatch(card, /Math\.pow|expectedScore|1\s*\/\s*\(\s*1\s*\+/,
    'the card must not contain Elo maths');
});

test('the form squares are built from the server rows, oldest to newest', () => {
  assert.match(card, /data\.rapidRecent/,
    'the squares must render the server-supplied rapidRecent rows');
  assert.doesNotMatch(card, /\.reverse\(\)/,
    'the card must not reverse the array; the server already sends oldest -> newest');
  /* It reuses the existing project classifier rather than a second icon system. */
  assert.match(card, /gameOutcome/,
    'the squares must reuse the existing gameOutcome W/D/L classifier');
  assert.match(card, /import \{ gameOutcome \}/, 'and import it');
});

test('win / loss / draw map to the required glyphs, with accessibility text', () => {
  /* Match the glyph ternary as ONE literal built from escapes, so the assertion
     cannot be broken by an editor's smart-quote or encoding handling.
     NB: `indexOf("{r === 'W' ? '")` finds the aria-label ternary first, so the
     search skips past it rather than assuming the glyphs come first. */
  const WIN = String.fromCodePoint(0x2713); // ✓
  const LOSS = String.fromCodePoint(0x2715); // ✕
  const DRAW = String.fromCodePoint(0x2014); // —
  const GLYPH_TERNARY = `{r === 'W' ? '${WIN}' : r === 'L' ? '${LOSS}' : '${DRAW}'}`;

  /* Two earlier ternaries spell the ARIA text ("win"/"draw"/"loss"), so the
     glyph ternary is located by the symbols themselves rather than by position:
     it is the occurrence that actually contains ✓. */
  const glyphAt = card.indexOf(`? '${WIN}'`);
  assert.ok(glyphAt > -1,
    `the squares must render \\u2713 for a win, \\u2715 for a loss and \\u2014 for a draw `
    + '(no ✓ glyph found in the card)');
  const start = card.lastIndexOf('{r', glyphAt);
  assert.equal(card.slice(start, start + GLYPH_TERNARY.length), GLYPH_TERNARY,
    'the glyph choice must be exactly ✓ for W, ✕ for L and — otherwise');
  assert.match(code, /aria-label=/, 'each square needs an aria-label');
  assert.match(code, /Rapid \$\{/, 'the aria-label must name the category (Rapid)');
  assert.match(code, /\?\s*'win'\s*:\s*r\s*===\s*'D'\s*\?\s*'draw'\s*:\s*'loss'/,
    'the accessible text must spell out win / draw / loss in words');
  assert.match(code, /opponentName/, 'the tooltip may carry the opponent');
});

test('a student with no rapid games gets no squares at all', () => {
  assert.match(card, /formSquares\.length\s*>\s*0/,
    'the strip must be gated on having rows');
  assert.doesNotMatch(card, /Array\(formLimit\)|Array\.from\(\{\s*length:\s*formLimit/,
    'no placeholder/empty boxes may be fabricated');
});

test('the delta annotation is visually smaller than the rating it annotates', () => {
  /* The rating keeps the text-2xl display size. */
  assert.match(code, /font-display text-2xl[^>]*>\s*\{shownRating\}/,
    'the rating keeps the text-2xl display size');
  assert.doesNotMatch(code, /text-(3xl|4xl|5xl)[^>]*>\s*\{shownRating\}/,
    'the rating must not be enlarged');
  assert.match(css, /\.rc-delta\s*\{[^}]*font-size:\s*0\.7rem/,
    'the delta chip must be sized well below the rating number');
  assert.match(css, /\.rc-delta\s*\{[^}]*display:\s*inline-flex/,
    'arrow + points sit on one baseline');
  /* The rating is no longer tinted by the delta - only the chip is. */
  assert.doesNotMatch(code, /font-display text-2xl[^>]*style=\{trendStyle\}/,
    'the delta colour must not be applied to the rating number itself');
});

test('the result squares are square, compact and responsive', () => {
  assert.match(css, /\.rc-form-box\s*\{[^}]*width:\s*1\.15rem[^}]*height:\s*1\.15rem/,
    'the squares must be square and compact');
  assert.match(css, /\.rc-form-row\s*\{[^}]*flex-wrap:\s*wrap/,
    'the row must wrap rather than overflow a narrow screen');
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.rc-form-box/,
    'narrow screens must tighten the squares rather than overflow');
});

test('the form colours reuse the project W/D/L palette', () => {
  assert.match(css, /\.rc-form-box\.is-w\s*\{\s*background:\s*#22c55e/,
    'win uses the existing green');
  assert.match(css, /\.rc-form-box\.is-d\s*\{\s*background:\s*#64748b/,
    'draw uses the existing neutral gray');
  assert.match(css, /\.rc-form-box\.is-l\s*\{\s*background:\s*#ef4444/,
    'loss uses the existing red');
});

test('peak stays a separate fact and is not gated on being above the rating', () => {
  assert.match(card, /Peak \{shownPeak\}/, 'peak is still displayed');
  assert.doesNotMatch(card, /shownPeak\s*>\s*shownRating\s*&&/,
    'peak must not be hidden exactly when the player is below it');
});

test('gameOutcome classifies the pool history result correctly', () => {
  /* The card forwards the pool row's bare `result` as `resultLabel`, which is
     the field this classifier reads first. These assertions pin that contract:
     if it changed, every square would silently disappear. */
  assert.equal(gameOutcome({ resultLabel: 'win', result: 'win' }), 'W');
  assert.equal(gameOutcome({ resultLabel: 'loss', result: 'loss' }), 'L');
  assert.equal(gameOutcome({ resultLabel: 'draw', result: 'draw' }), 'D');
  /* An unscored result yields null, which the card filters out rather than
     rendering a misleading square. */
  assert.equal(gameOutcome({ resultLabel: 'abandoned', result: 'abandoned' }), null);
  assert.equal(gameOutcome({ result: 'draw' }), 'D', 'a bare draw is still a draw');
});

test('the card forwards the result under the field gameOutcome reads', () => {
  assert.match(code, /gameOutcome\(\{\s*resultLabel:\s*g\.result/,
    'the pool row result must be passed as resultLabel, which gameOutcome reads first');
});