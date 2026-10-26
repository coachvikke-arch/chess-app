/**
 * The profile viewer's score-sheet panel must keep the same MODEL as the GM
 * replay's score sheet.
 *
 * WHY A PARITY TEST
 *
 * There are two score sheets in the app. GM games has one (its move-list panel is
 * literally labelled "Score sheet"), and the profile viewer has its own. They are
 * separate implementations in separate files, which is exactly how two panels
 * drift: one gains a move-count badge or severity colours and the other quietly
 * does not, and nobody notices until the two screens look nothing alike.
 *
 * The two CANNOT share CSS classes: the `.gm-*` rules are painted for GM's dark
 * board (`#d8e8f1` moves, `#16232f` header) and the profile viewer is a warm
 * cream page, where those tokens would be barely legible. So the model is mirrored
 * under `cp-score*` names with light values — which means the structure has to be
 * asserted explicitly, element by element, or "same model" degrades into a vague
 * intention nobody checks.
 *
 * These assertions name the CONCEPT each piece must carry, not a specific hex
 * value, so a palette tweak does not fail the suite while a structural removal
 * does.
 *
 * Run with: npm run test:score-sheet-parity
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gm = readFileSync(join(ROOT, 'src', 'components', 'GameReplay.tsx'), 'utf8');
/* The profile's score sheet lives in components/GameViewerCard.jsx now — the card
   was extracted from the page so the Brilliant Moves list opens the SAME one.
   Reading it here keeps this parity test meaningful: the two score sheets are
   still mirrors of each other, they just live in components now. */
const profile = readFileSync(join(ROOT, 'src', 'components', 'GameViewerCard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

test('GM games still has the reference score-sheet panel', () => {
  /* The model this mirrors. If GM ever drops it, the parity assertions below
     need revisiting rather than silently comparing against nothing. */
  assert.match(gm, /gm-eyebrow">Score sheet</, 'GM panel is labelled Score sheet');
  assert.match(gm, /className="is-white"/, 'GM head names White');
  assert.match(gm, /className="is-black"/, 'GM head names Black');
  assert.match(gm, /gm-move-badge/, 'GM panel shows a move count');
  assert.match(gm, /gm-score-head/, 'GM has a sticky column head');
});

test('the profile panel carries the same elements', () => {
  /* Eyebrow label. */
  assert.match(profile, /cp-score-eyebrow">Score sheet</, 'profile panel is labelled Score sheet');
  /* Move count, with the singular/plural handled. */
  assert.match(profile, /cp-score-badge/, 'move count badge present');
  assert.match(
    profile,
    /\{moveCount === 1 \? 'move' : 'moves'\}/,
    'the move count is pluralised, as GM does',
  );
  /* Result + end status, from the same source the removed card read. */
  assert.match(profile, /cp-score-result/, 'result and reason are shown');
  assert.match(profile, /endInfo\.result/, 'result token is shown');
  assert.match(profile, /endInfo\.headline/, 'end reason is shown');
});

test('the players are named by the sticky column head, colour-coded', () => {
  /* The panel deliberately does NOT repeat the names in a decorative
     "<name> vs <name>" heading. That line duplicated the column head, and because
     the head is sticky, scrolling a long game kept a third copy pinned on screen.

     The column head is the copy worth keeping: it labels the two move columns
     and stays visible while the moves scroll, so which player a column belongs
     to is never lost. */
  assert.doesNotMatch(profile, /cp-score-vs/, 'the duplicate vs line must be gone');
  assert.match(
    profile,
    /cp-score-row--head[\s\S]{0,500}?\{whiteLabel\}[\s\S]{0,400}?\{blackLabel\}/,
    'the sticky column head names both players',
  );
  /* Names come from this viewer's own fields, with a fallback. */
  assert.match(profile, /whiteLabel = gameData\.white_name \|\| 'Unknown player'/);
  assert.match(profile, /blackLabel = gameData\.black_name \|\| 'Unknown player'/);
  /* Colour differentiation survives on the column headers. */
  assert.match(profile, /cp-score-row--head[\s\S]{0,300}?is-white/, 'White is colour-coded');
  assert.match(profile, /cp-score-row--head[\s\S]{0,400}?is-black/, 'Black is colour-coded');
  assert.ok(css.includes('.cp-score-row--head .is-white'), 'and both are styled');
  assert.ok(css.includes('.cp-score-row--head .is-black'), 'and both are styled');
});

test('the removed vs-line styles are gone', () => {
  for (const cls of ['.cp-score-vs', '.cp-score-vs-sep']) {
    assert.ok(!css.includes(cls), `dead rule ${cls} should have been removed`);
  }
});

test('the profile move table is a real score sheet, not a plain list', () => {
  /* A grid of `# | White | Black`, as GM does. This is what makes it a score
     sheet rather than a run of moves: the columns have to stay aligned. */
  assert.match(profile, /cp-score-row--head/, 'sticky column head present');
  assert.match(profile, /role="columnheader"/, 'columns are labelled for assistive tech');
  assert.match(profile, /cp-score-num/, 'move numbers are their own column');
  /* Both sides of a row, and a real empty cell so a game ending after White's
     move does not break the columns. */
  assert.match(profile, /\[0, 1\]\.map/, 'both moves of a pair are rendered');
  assert.match(profile, /cp-score-cell is-empty/, 'a missing move renders an empty cell');

  /* The columns are aligned by a shared grid definition, not per-row inline
     widths — that is what stops the numbers drifting out of step down a long
     game, which is the whole reason a score sheet is a table. */
  assert.match(
    css,
    /\.cp-score-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:/,
    'rows share one grid definition, so the columns line up',
  );
});

test('the move table scrolls and keeps its header visible', () => {
  assert.match(css, /\.cp-score\s*\{[\s\S]*?overflow-y:\s*auto/, 'the table scrolls');
  assert.match(css, /\.cp-score-row--head\s*\{[\s\S]*?position:\s*sticky/, 'the head is sticky');
});

test('severity colouring is defined for every verdict tier', () => {
  /* REVIEW_META has 10 tiers. GM only defines 5, so copying GM's list verbatim
     would leave the rarer verdicts looking like "no verdict at all". Every key
     must have a rule or the cell falls back to plain text. */
  const tiers = [
    'brilliant', 'great', 'best', 'excellent', 'good',
    'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
  ];
  for (const t of tiers) {
    assert.match(
      css,
      new RegExp(`\\.cp-score-cell\\.is-${t}\\b`),
      `no colour rule for the "${t}" verdict`,
    );
  }
  /* And the class is actually applied from the verdict, not left as dead CSS.
     The class is built from the DISPLAY verdict, so a Sigma row ("sigma") asks
     for .is-brilliant — the rule that exists — rather than a .is-sigma class that
     does not. */
  assert.match(
    profile,
    /is-\$\{getDisplayVerdict\(v\.verdict\)\.toLowerCase\(\)\}/,
    'the grade class is applied from the normalised verdict',
  );
  /* The glyph inherits the cell colour rather than fighting it with an inline
     style, which is how the GM score sheet does it. */
  assert.doesNotMatch(profile, /cp-score-badge-glyph"\s+style=/, 'glyph must not hard-code a colour');
});

test('the active move is highlighted and reachable by keyboard', () => {
  assert.match(profile, /is-active/, 'the current move is marked');
  assert.match(css, /\.cp-score-cell\.is-active\s*\{/, 'the active move is styled');
  assert.match(css, /\.cp-score-cell:focus-visible/, 'keyboard focus is visible');
});

test('the profile stylesheet is self-contained and light-themed', () => {
  /* It must NOT borrow GM's dark tokens, or the model merge becomes a legibility
     regression on the cream page.

     Comments are stripped first: this file's own notes legitimately NAME the GM
     rules being mirrored, and a naive search would flag the documentation as if it
     were a dependency. */
  const start = css.indexOf('.cp-score-head {');
  const end = css.indexOf('.cp-score-cell.is-blunder');
  assert.ok(start > -1 && end > start, 'the cp-score block must exist');
  const block = css
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.doesNotMatch(block, /\.gm-/, 'cp-score styles must not reference gm- classes');
  for (const dark of ['#d8e8f1', '#16232f', '#7da2c4']) {
    assert.ok(!block.includes(dark), `dark GM token ${dark} must not appear in the profile panel`);
  }
});

test('the retired cp-mv list styles are gone', () => {
  /* The old plain move list was replaced by the score sheet. Leaving its CSS
     behind is dead weight that the next reader has to work out is unused. */
  for (const cls of ['cp-movelist', 'cp-mvpair', 'cp-mvnum', 'cp-mv-slot', 'cp-mv-badge']) {
    assert.ok(!css.includes(`.${cls}`), `dead rule .${cls} should have been removed`);
    assert.ok(!profile.includes(cls), `dead class ${cls} should not be referenced`);
  }
  /* cp-mv-empty is still used for the empty and error states, so it must stay. */
  assert.match(profile, /cp-mv-empty/, 'the empty/error message class is still in use');
  assert.ok(css.includes('.cp-mv-empty'), 'and still styled');
});
