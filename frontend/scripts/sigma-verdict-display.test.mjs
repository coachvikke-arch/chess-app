import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

/**
 * REGRESSION: a Sigma verdict must reach the screen as the Brilliant badge.
 *
 * THE BUG THIS PINS
 * The classification layer names the top tier 'sigma' (see src/utils/sigmaType.js)
 * while everything visual — REVIEW_META, RANK_GLYPHS, the `.move-badge-dot--brilliant`
 * CSS hook, the `is-brilliant` cell class, the summary row — keys off 'brilliant'.
 * A row stored as 'sigma' therefore resolved to NO metadata anywhere: no badge on
 * the board, no tint, no row in the score sheet, and a Brilliant count of 0 for a
 * game that plainly had one. Nothing threw; the move was simply invisible.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * Whether a move IS brilliant. That is reviewClassify.classifyMove's decision
 * (thresholds, sacrifice geometry, settledNetSacrifice) and none of it may move
 * to make a badge appear — a test that re-derives the verdict would only pin the
 * classifier's own tuning. These tests start from verdict ids and assert the
 * display layer renders both spellings identically.
 *
 * Run: node --test scripts/sigma-verdict-display.test.mjs
 */

import {
  isSigmaVerdict, normaliseVerdict, getDisplayVerdict, SIGMA_VERDICT, LEGACY_SIGMA_VERDICT,
} from '../src/utils/sigmaType.js';
import { REVIEW_META, REVIEW_ORDER, reviewMetaFor, reviewCounts } from '../src/utils/gameReview.js';
import { aggregateSide } from '../src/utils/reviewAccuracy.js';

/* ── the canonical check ─────────────────────────────────────────────────*/

test('isSigmaVerdict recognises both spellings and nothing else', () => {
  assert.strictEqual(SIGMA_VERDICT, 'sigma');
  assert.strictEqual(LEGACY_SIGMA_VERDICT, 'brilliant');
  assert.strictEqual(isSigmaVerdict('sigma'), true);
  assert.strictEqual(isSigmaVerdict('brilliant'), true, 'old stored rows must keep working');
  for (const v of ['best', 'great', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']) {
    assert.strictEqual(isSigmaVerdict(v), false, `${v} is not a Sigma`);
  }
  assert.strictEqual(isSigmaVerdict(null), false);
  assert.strictEqual(isSigmaVerdict(undefined), false);
});

/* ── the display normalisation ───────────────────────────────────────────*/

test('getDisplayVerdict maps Sigma onto the key the UI draws', () => {
  assert.strictEqual(getDisplayVerdict('sigma'), 'brilliant');
  assert.strictEqual(getDisplayVerdict('brilliant'), 'brilliant', 'already legacy: unchanged');
  assert.strictEqual(getDisplayVerdict('best'), 'best');
  assert.strictEqual(getDisplayVerdict('great'), 'great');
  assert.strictEqual(getDisplayVerdict('mistake'), 'mistake');
  assert.strictEqual(getDisplayVerdict(null), null);
  assert.strictEqual(getDisplayVerdict(undefined), undefined);
});

test('getDisplayVerdict is idempotent — normalising twice changes nothing', () => {
  /* A component that normalises a value another component already normalised is
     not a bug, it has to be a no-op. */
  for (const v of ['sigma', 'brilliant', 'best', 'blunder', null]) {
    assert.strictEqual(getDisplayVerdict(getDisplayVerdict(v)), getDisplayVerdict(v));
  }
});

test('normaliseVerdict still folds the legacy id the other way', () => {
  assert.strictEqual(normaliseVerdict('brilliant'), 'sigma');
  assert.strictEqual(normaliseVerdict('sigma'), 'sigma');
  assert.strictEqual(normaliseVerdict('best'), 'best');
});

/* ── REVIEW_META ─────────────────────────────────────────────────────────*/

test('REVIEW_META has an entry for the canonical Sigma verdict', () => {
  assert.ok(REVIEW_META[SIGMA_VERDICT], 'REVIEW_META.sigma must exist');
  /* THE SAME OBJECT, not a copy: the two spellings cannot be allowed to describe
     the same tier differently. */
  assert.strictEqual(REVIEW_META[SIGMA_VERDICT], REVIEW_META[LEGACY_SIGMA_VERDICT]);
});

test('the Sigma entry is the existing Brilliant visual, unchanged', () => {
  const m = REVIEW_META[SIGMA_VERDICT];
  assert.strictEqual(m.glyph, '!!');
  assert.strictEqual(m.color, '#19c9c3');
  assert.strictEqual(m.deep, '#0a807d');
  assert.strictEqual(m.light, '#59e8df');
  assert.strictEqual(m.glow, true, 'the premium halo belongs to this tier');
});

/* The tier is called "Brilliant" everywhere the player can read it. 'sigma' is an
   internal id, so the string must not survive into any label - and because both
   spellings share one metadata object, one assertion covers both routes. */
test('the player-facing label is Brilliant, and Sigma is never rendered', () => {
  for (const key of [SIGMA_VERDICT, LEGACY_SIGMA_VERDICT]) {
    assert.strictEqual(REVIEW_META[key].label, 'Brilliant',
      `${key} must be presented to the player as Brilliant`);
    assert.ok(!REVIEW_META[key].label.toLowerCase().includes('sigma'),
      'the internal classification id must not reach the screen');
  }
});

test('reviewMetaFor resolves both spellings to the same metadata', () => {
  assert.strictEqual(reviewMetaFor('sigma'), REVIEW_META.brilliant);
  assert.strictEqual(reviewMetaFor('brilliant'), REVIEW_META.brilliant);
  assert.strictEqual(reviewMetaFor('best'), REVIEW_META.best);
  /* An unknown id is null, not a throw, and not a Sigma. */
  assert.strictEqual(reviewMetaFor('pretty_good'), null);
  assert.strictEqual(reviewMetaFor(null), null);
  assert.strictEqual(reviewMetaFor(undefined), null);
});

test('REVIEW_ORDER lists the tier once, not once per spelling', () => {
  const sigmaRows = REVIEW_ORDER.filter((k) => isSigmaVerdict(k));
  assert.deepStrictEqual(sigmaRows, ['brilliant'],
    'two keys for one tier would print the same badge twice with the count split');
});

/* ── the counts (summary table, legend, accuracy) ─────────────────────────*/

test('a mixed review tallies exactly two brilliant moves', () => {
  const rows = [
    { verdict: 'sigma' }, { verdict: 'brilliant' }, { verdict: 'best' },
    { verdict: 'great' }, { verdict: 'mistake' },
  ];
  const init = Object.fromEntries(REVIEW_ORDER.map((v) => [v, 0]));
  const { counts } = aggregateSide(rows.map((r, i) => ({ ...r, player: 'w', loss: null })), 'w', init);
  assert.strictEqual(counts.brilliant, 2, 'both spellings count as brilliant');
  assert.strictEqual(counts.best, 1);
  assert.strictEqual(counts.great, 1);
  assert.strictEqual(counts.mistake, 1);
  /* No orphan key is left behind, and no NaN poisons the totals read from it. */
  assert.strictEqual(counts[SIGMA_VERDICT], undefined);
  assert.strictEqual(counts.sigma, undefined);
  for (const [k, v] of Object.entries(counts)) assert.ok(Number.isFinite(v), `counts.${k} must be a number`);
});

test('a per-side tally splits by player, Sigma included', () => {
  const init = Object.fromEntries(REVIEW_ORDER.map((v) => [v, 0]));
  const rows = [
    { player: 'w', verdict: 'sigma', loss: null },
    { player: 'b', verdict: 'brilliant', loss: null },
    { player: 'w', verdict: 'best', loss: null },
  ];
  assert.strictEqual(aggregateSide(rows, 'w', init).counts.brilliant, 1);
  assert.strictEqual(aggregateSide(rows, 'b', init).counts.brilliant, 1);
});

test('an unrecognised verdict cannot poison the tally with NaN', () => {
  const init = Object.fromEntries(REVIEW_ORDER.map((v) => [v, 0]));
  const { counts } = aggregateSide(
    [{ player: 'w', verdict: 'invented_tier', loss: null }], 'w', init,
  );
  for (const [k, v] of Object.entries(counts)) assert.ok(Number.isFinite(v), `counts.${k} must be a number`);
});

test('reviewCounts folds a stored counts.sigma onto brilliant', () => {
  /* A session saved before the fix carries the orphan key. Reading only
     counts.brilliant would report 0 brilliant moves for a game that has one. */
  const folded = reviewCounts({ brilliant: 1, sigma: 2, best: 5 });
  assert.strictEqual(folded.brilliant, 3);
  assert.strictEqual(folded.sigma, undefined);
  assert.strictEqual(folded.best, 5);
  /* Already-normalised input is returned as-is, so there is no needless copy on
     the common path. */
  const plain = { brilliant: 1, best: 2 };
  assert.strictEqual(reviewCounts(plain), plain);
  assert.strictEqual(reviewCounts(null), null);
});

test('every key the summary table reads has metadata', () => {
  /* The table renders REVIEW_ORDER verbatim; a key with no entry is a blank row. */
  for (const key of REVIEW_ORDER) {
    assert.ok(REVIEW_META[key], `no metadata for the "${key}" tier`);
  }
});

/* ── the board badge ──────────────────────────────────────────────────────*/

test('the badge components normalise the verdict before drawing it', () => {
  /* Read the source rather than rendering: these are .jsx, and a structural check
     is what stops someone re-introducing a raw REVIEW_META[verdict] lookup. */
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const badge = src('components/MoveBadge.jsx');
  const ranks = src('components/RankBadges.jsx');
  for (const [name, text] of [['MoveBadge', badge], ['RankBadges', ranks]]) {
    assert.match(text, /getDisplayVerdict/, `${name} must normalise the verdict`);
  }
  /* The coin glyphs stay keyed by the legacy tier name — a Sigma row is drawn
     as the badge it always was, not as a new icon. */
  assert.match(ranks, /brilliant:\s*\(/, 'the "!!" coin is still keyed by brilliant');
  /* And the premium halo still belongs to exactly that tier. */
  assert.strictEqual(REVIEW_META[SIGMA_VERDICT].glow, true);
});

/* ── persistence ───────────────────────────────────────────────────────────
   Covered in sigma-persist.test.mjs, which owns that module: importing it here
   would drag in the app's axios config (sigmaPersist imports ../services/api,
   an extensionless specifier Node ESM cannot resolve). The gate it pins is the
   same isSigmaVerdict used here. */

/* ── the pages that read the verdict ──────────────────────────────────────*/

test('Game Review and the profile viewer look metadata up through reviewMetaFor', () => {
  /* A raw REVIEW_META[verdict] in either page returns undefined for 'sigma', and
     a missing entry is a silently absent badge rather than an error — which is how
     a brilliant move came to look like no verdict at all.

     The profile's game card now lives in components/GameViewerCard.jsx (extracted
     so the Brilliant Moves list opens the SAME card), so that component is checked
     alongside the page that renders it. */
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  /* The page itself no longer READS verdicts: its game card moved to
     components/GameViewerCard.jsx, which is where the lookup has to happen. The
     page is still checked because it must not reintroduce a raw lookup. */
  for (const page of ['components/GameViewerCard.jsx']) {
    const text = src(page);
    assert.match(text, /reviewMetaFor/, `${page} must resolve metadata through reviewMetaFor`);
    assert.doesNotMatch(
      text, /REVIEW_META\[\w+\.?verdict\]/,
      `${page} must not index REVIEW_META with a raw verdict again`,
    );
  }
  for (const page of ['pages/GameReview.jsx', 'pages/ChessProfile.jsx']) {
    const text = src(page);
    assert.doesNotMatch(
      text, /REVIEW_META\[\w+\.?verdict\]/,
      `${page} must not index REVIEW_META with a raw verdict again`,
    );
    assert.doesNotMatch(
      text, /REVIEW_META\[\w+\.?verdict\]/,
      `${page} must not index REVIEW_META with a raw verdict again`,
    );
  }
});

test('no user-facing string calls the top tier "Sigma"', () => {
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  /* A quoted-literal scan would miss bare JSX text - and bare JSX text is exactly
     what the tab label is - so this looks for the word itself in live code.
     Comments are stripped first: the source is full of notes about the internal
     'sigma' id, and prose in a comment is not something a player can read.

     \bSigma\b matches none of the internal names: the metadata is 'SIGMA_TYPE_META'
     and '/sigma/moves' and 'gr-sigma-card' are lowercase, and a word boundary does
     not fire inside the SigmaMoves component. Verified over all of src/. */
  for (const file of [
    'utils/gameReview.js',
    'utils/sigmaType.js',
    'utils/reviewAccuracy.js',
    'utils/sigmaPersist.js',
    'components/MoveBadge.jsx',
    'components/RankBadges.jsx',
    'components/SigmaMoves.jsx',
    'pages/GameReview.jsx',
    'pages/ChessProfile.jsx',
  ]) {
    const live = src(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(live, /\bSigma\b/, `${file} must not render the internal id Sigma`);
  }
});
