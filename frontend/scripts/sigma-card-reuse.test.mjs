/* ──────────────────────────────────────────────────────────────────────────
 * The Brilliant Moves list must behave as an entry point into the SAME
 * full-game analysis card Chess Profile uses — same board, same move list, same
 * canonical classifications, positioned on the selected move with it ALREADY
 * PLAYED.
 *
 * These assertions are static (source-level) on purpose: the guarantee is that
 * the card is a shared component and that no verdict is derived in the list, and
 * both are properties of the wiring rather than of a rendering. The behavioural
 * arithmetic (after-move FEN, ply→index, colours) is unit-tested in
 * sigma-display.test.mjs; the click wiring is checked here.
 *
 * Run: node --test scripts/sigma-card-reuse.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SIGMA = read('src/components/SigmaMoves.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const PROFILE = read('src/pages/ChessProfile.jsx');
const REVIEW = read('src/pages/GameReview.jsx');
const DISPLAY = read('src/utils/sigmaDisplay.js');

/* ── one card, reused ─────────────────────────────────────────────────────── */

test('the card is a single shared component, imported by both surfaces', () => {
  assert.match(CARD, /export default function GameViewerCard/,
    'the card is its own reusable component');
  assert.match(PROFILE, /import GameViewerCard from '\.\.\/components\/GameViewerCard'/);
  assert.match(REVIEW, /import GameViewerCard from '\.\.\/components\/GameViewerCard'/);
});

test('Chess Profile renders the shared card rather than a private copy', () => {
  assert.match(PROFILE, /<GameViewerCard/);
  /* The old inline viewer body must be gone — a second implementation is exactly
     what this refactor exists to prevent. */
  assert.doesNotMatch(PROFILE, /function GameViewer\(\{ game, onClose \}\) \{[\s\S]*cp-viewer-side/,
    'no duplicated cp-viewer body left in the page');
  assert.doesNotMatch(PROFILE, /analyzeCanonical/,
    'the page no longer runs its own analysis call');
});

test('the card consumes the canonical pipeline, not a private classifier', () => {
  assert.match(CARD, /analyzeCanonical/);
  assert.match(CARD, /reviewMetaFor/);
  /* No local thresholds, no local sigma detection, no second accuracy model. */
  assert.doesNotMatch(CARD, /LOSS_THRESHOLDS|labelFromLoss|classifyMove|brilliantGates/);
  assert.doesNotMatch(CARD, /accuracyFor\b/);
});

/* ── the brilliant list derives nothing ───────────────────────────────────── */

test('the list draws the after-move position via the shared helper', () => {
  assert.match(SIGMA, /sigmaCardBoard/);
  assert.match(SIGMA, /fen=\{cardBoard\.fen\}/,
    'the board is fed the AFTER position');
  assert.doesNotMatch(SIGMA, /fen=\{m\.fenBefore\}/,
    'the before-position board is gone');
});

test('the card arrow and square use the canonical Brilliant colour', () => {
  assert.match(SIGMA, /color: cardBoard\.color/, 'arrow colour comes from the helper');
  assert.match(SIGMA, /reviewVerdictColor=\{cardBoard\.color\}/, 'destination square too');
  assert.doesNotMatch(SIGMA, /#f59e0b/, 'the old hardcoded amber is gone');
  /* and the helper READS it from REVIEW_META rather than defining it again */
  assert.match(DISPLAY, /reviewMetaFor\(SIGMA_VERDICT\)/);
  /* The only literal is a defensive fallback if REVIEW_META ever lost the entry —
     and it is asserted to equal the canonical value, so it cannot drift into a
     second "Brilliant" colour. */
  const canonical = read('src/utils/gameReview.js');
  assert.match(canonical, /color: '#19c9c3'/,
    'REVIEW_META still owns the Brilliant colour');
  assert.match(DISPLAY, /\|\| '#19c9c3'/, 'the helper only falls back to that same value');
});

test('the destination square is highlighted and badged', () => {
  assert.match(SIGMA, /lastMove=\{\{ from: cardBoard\.from, to: cardBoard\.to \}\}/);
  assert.match(SIGMA, /moveBadge=\{cardBadge/);
  assert.match(SIGMA, /destinationBadge\(m\.fromSquare, m\.toSquare\)/);
});

test('the list never derives a verdict of its own', () => {
  assert.doesNotMatch(SIGMA, /reviewMetaFor|classifyMove|brilliantGates|sacrificeCandidate/);
  /* It may READ the sigma type label, which is stored metadata. */
  assert.match(SIGMA, /SIGMA_TYPE_META\[m\.sigmaType\]/);
});

/* ── ply → position ───────────────────────────────────────────────────────── */

test('the click hands over a ply-converted move index, not the move number', () => {
  assert.match(SIGMA, /plyToMoveIndex\(m\.ply/);
  assert.doesNotMatch(SIGMA, /onOpenGame && onOpenGame\(m\)\s*\)/,
    'the raw row alone is no longer the whole contract');
});

test('the card positions the board at that move index', () => {
  assert.match(CARD, /initialMoveIndex/);
  assert.match(CARD, /go\(startIndex, false\)/,
    'the requested move is established without replaying its effect on open');
  /* Clamped, so a stale request cannot point past the last move. */
  assert.match(CARD, /Math\.min\(n, i\)/);
});

/* ── click → full game card ───────────────────────────────────────────────── */

test('clicking a brilliant opens the card, which then resolves the game', () => {
  /* Synchronous open; the card owns the fetch (and its loading/error states).
     See sigma-click-flow.test.mjs for the full click-flow contract. */
  assert.match(REVIEW, /function openSigmaGame\(move, nav\)/);
  assert.doesNotMatch(REVIEW, /async function openSigmaGame/,
    'the click must not await anything before showing something');
  assert.match(REVIEW, /setSigmaGame\(\{/);
  assert.match(REVIEW, /<GameViewerCard/);
  /* The whole flow is automatic: no second click, no manual open first. */
  assert.match(REVIEW, /onOpenGame=\{\(m, nav\) => openSigmaGame\(m, nav\)\}/);
});

test('the review board itself is untouched by the card', () => {
  /* The card renders after the Page's children, as a sibling overlay — the
     review ternary and board JSX are unchanged. */
  assert.match(REVIEW, /\{tab === 'sigma' \?/);
  assert.match(REVIEW, /className="gr-layout"/);
  assert.match(REVIEW, /reviewVerdictColor=\{reviewMetaFor\(curVerdict\)\?\.color \|\| null\}/,
    'the review board still uses the canonical verdict colour');
});

/* ── race safety ──────────────────────────────────────────────────────────── */

test('a stale game response cannot overwrite a newer click', () => {
  /* The card now opens synchronously and resolves the game itself, so the
     race guard moved with it: the load effect captures `alive` and clears it on
     cleanup, so a slow response from a game the user has already navigated away
     from can never write into the current card. */
  assert.match(CARD, /let alive = true;[\s\S]{0,400}?return \(\) => \{ alive = false; \};/,
    'the card ignores a load that finished after it changed/unmounted');
  /* and it never writes state from a stale response */
  const writes = CARD.match(/if \(!alive\) return;/g) || [];
  assert.ok(writes.length >= 2, 'every async outcome checks the guard first');
});

test('the card key includes the game AND the move, so two brilliants never share state', () => {
  assert.match(REVIEW, /key=\{sigmaGame\.key\}/);
  assert.match(REVIEW, /key: `\$\{ref\.gameSource\}:\$\{ref\.gameId\}:\$\{move\.ply\}`/);
});

/* ── nothing analysis-side changed ────────────────────────────────────────── */

test('no analysis or classification file is touched by this work', () => {
  /* These are the files this task must not modify; the card must not import a
     second implementation of any of them. */
  for (const forbidden of ['classifyMove', 'brilliantGates', 'sacrificeCandidate',
    'protectedSacrificeGeometry', 'settledNetSacrifice', 'hasSettledSacrifice',
    'winPercentDrop', 'moveAccuracy', 'aggregateSide']) {
    assert.doesNotMatch(CARD, new RegExp(forbidden), `card must not call ${forbidden}`);
    assert.doesNotMatch(SIGMA, new RegExp(forbidden), `list must not call ${forbidden}`);
  }
  /* It may call the canonical entry point, never reviewGame directly with its
     own configuration. */
  assert.doesNotMatch(CARD, /reviewGame\(/, 'the card goes through analyzeCanonical');
  assert.doesNotMatch(CARD, /engineOverrides/, 'the card sets no engine config of its own');
});