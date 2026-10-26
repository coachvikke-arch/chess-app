/* ──────────────────────────────────────────────────────────────────────────
 * Move effects must play on the board the user is LOOKING at.
 *
 * The regression: the Play Arena mounts two boards at once — the page board and
 * its full-screen Play Mode board (a portal above the page) — and they share
 * one Chess instance. An effect that named no board went to "the last board the
 * user touched", which in Play Mode is the board BEHIND the overlay; and since
 * the effect run is global (one at a time) the hidden board even REPLACED the
 * run the visible board was playing. Play Mode therefore showed no promotion
 * ripple, no mate animation and no brilliant glow at all.
 *
 * The fix is one shared resolution chain (effects/moveEffect/visibleHost.js):
 *
 *   explicit boardId  →  the VISIBLE host  →  the last-touched host
 *
 * plus a board that is not the visible one playing nothing (and clearing
 * nothing).
 *
 * Run: node --test scripts/move-effect-target.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  setVisibleEffectHost,
  getVisibleEffectHost,
  clearVisibleEffectHost,
  resolveEffectTarget,
} from '../src/effects/moveEffect/visibleHost.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const BOARD = read('src/components/ChessBoard.jsx');
const ARENA = read('src/pages/AnalysisBoard.jsx');
const REVIEW = read('src/pages/GameReview.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const BADGE = read('src/components/MoveBadge.jsx');
const EFFECT = read('src/effects/moveEffect/MoveEffect.jsx');
const INDEX = read('src/effects/moveEffect/index.js');
const FEEDBACK = read('src/utils/moveFeedback.js');

/* ── the resolution chain ─────────────────────────────────────────────────── */

test('an explicit board wins over everything else', () => {
  assert.equal(
    resolveEffectTarget({ explicitBoardId: 'explicit', visibleHostId: 'visible', activeHostId: 'active' }),
    'explicit',
  );
});

test('the VISIBLE board wins over the last-touched one', () => {
  /* THE Play Mode fix: the page board was the last-touched host, but the Play
     Mode board is the one on top. */
  assert.equal(
    resolveEffectTarget({ explicitBoardId: null, visibleHostId: 'play-mode', activeHostId: 'page' }),
    'play-mode',
  );
});

test('the last-touched board is the fallback', () => {
  assert.equal(
    resolveEffectTarget({ explicitBoardId: null, visibleHostId: null, activeHostId: 'active' }),
    'active',
  );
  assert.equal(resolveEffectTarget(), null, 'no board at all is a valid answer');
});

test('the visible host can be declared and restored', () => {
  const restoreA = setVisibleEffectHost('A');
  assert.equal(getVisibleEffectHost(), 'A');
  const restoreB = setVisibleEffectHost('B');
  assert.equal(getVisibleEffectHost(), 'B');
  restoreB();
  assert.equal(getVisibleEffectHost(), 'A', 'closing the overlay restores the board below it');
  restoreA();
  assert.equal(getVisibleEffectHost(), null);
});

test('a board that goes away releases the visible host', () => {
  setVisibleEffectHost('A');
  clearVisibleEffectHost('B');
  assert.equal(getVisibleEffectHost(), 'A', 'another board must not clear it');
  clearVisibleEffectHost('A');
  assert.equal(getVisibleEffectHost(), null);
});

/* ── the board must not steal the effect ──────────────────────────────────── */

test('a board that is not the visible one plays nothing and clears nothing', () => {
  assert.match(BOARD, /const ownsEffectTarget = useCallback/, 'the board must know whether it is the target');
  assert.match(BOARD, /if \(!ownsEffectTarget\(\)\) return null;/,
    'a board that is not on top must not fire');
  assert.match(BOARD, /if \(fired === false\) clearMoveEffects\(\);/,
    'only "nothing to play" may clear the effect - "not my board" must not');
});

test('the board releases the visible host when it unmounts', () => {
  assert.match(BOARD, /clearVisibleEffectHost\(moveEffectHostId\)/);
});

test('the effect core resolves the target through the shared chain', () => {
  assert.match(INDEX, /resolveEffectTarget\(\{/);
  assert.match(INDEX, /visibleHostId: getVisibleEffectHost\(\)/);
  assert.match(INDEX, /activeHostId,/);
});

/* ── the surfaces declare their board ─────────────────────────────────────── */

test('the Play Arena names both boards and declares the one on top', () => {
  assert.match(ARENA, /const pageBoardHostId = useId\(\)/);
  assert.match(ARENA, /const playModeBoardHostId = useId\(\)/);
  assert.match(ARENA, /useVisibleEffectHost\(playMode \? playModeBoardHostId : pageBoardHostId\)/,
    'Play Mode must own the effect target while it is open');
  /* The two boards are rendered by the ONE shared board component, which takes
     the host id as a prop. */
  assert.match(ARENA, /<ArenaBoard/);
  assert.match(ARENA, /effectHostId=\{pageBoardHostId\}/);
  assert.match(ARENA, /effectHostId=\{playModeBoardHostId\}/);
});

test('the review page and the imported-game card name their boards', () => {
  assert.match(REVIEW, /useVisibleEffectHost\(reviewBoardHostId\)/);
  assert.match(REVIEW, /moveEffectHostId=\{reviewBoardHostId\}/);
  assert.match(CARD, /useVisibleEffectHost\(effectHostId\)/);
  assert.match(CARD, /moveEffectHostId=\{effectHostId\}/);
});

/* ── the brilliant badge is back ──────────────────────────────────────────── */

test('the board badge is shown for a brilliant move again', () => {
  assert.doesNotMatch(BADGE, /showsMoveBadge|isQuietMoveEvent/,
    'the "!!" coin is the app\'s own classification badge - it must be back');
  assert.match(BADGE, /<RankIcon verdict=\{shown\}/);
});

test('the move list and the score sheet show the badge again', () => {
  assert.doesNotMatch(REVIEW, /showsMoveBadge/);
  assert.doesNotMatch(CARD, /showsMoveBadge/);
  assert.match(REVIEW, /<RankBadge verdict=\{v\.verdict\} size=\{17\}/);
  assert.match(CARD, /cp-score-badge-glyph/);
});

test('the effect overlay stays quiet for the three special events', () => {
  assert.match(FEEDBACK, /ANIMATION_ONLY_EVENTS = Object\.freeze\(\['brilliant', 'checkmate', 'promotion'\]\)/);
  assert.match(EFFECT, /const quiet = isQuietMoveEvent\(effect\?\.type\)/);
  assert.match(EFFECT, /\{!quiet && \(\s*<div\s*\n\s*ref=\{sealRef\}/,
    'the overlay seal must not land on the same corner as the board badge');
});

/* ── the badge follows the move ──────────────────────────────────────────── */

test('the badge is bound to the move being shown', () => {
  /* The badge is the board's `moveBadge` prop, which every surface derives from
     the CURRENT move - so it is gone on the next move and back on undo/redo. */
  assert.match(REVIEW, /const moveBadge = useMemo\(/);
  assert.match(ARENA, /const reviewMoveBadge = useMemo\(/);
  assert.match(ARENA, /moveBadge=\{reviewMoveBadge\}/);
  assert.match(CARD, /const moveBadge = useMemo\(/);
});

/* ── the completion card waits for the mate animation ────────────────────── */

test('the completion card waits for the checkmate animation and appears once', () => {
  /* Play Mode renders its own result card; it must stay hidden while the mating
     animation is still running, and it must not come back on undo/redo. */
  assert.match(ARENA, /open=\{!resultDismiss && !resultRevealPending\}/,
    'the card must be gated on the animation having finished');
  assert.match(ARENA, /resultRevealCancelRef\.current = revealAfterCheckmate\(/,
    'the wait must be the animation\'s own end signal');
  /* The reveal is keyed by the mating position, so a redo of the same mate is
     the same attempt and the card does not reappear. */
  const completion = read('src/effects/moveEffect/completion.js');
  assert.match(completion, /shownKeys\.has\(completionKey\)/,
    'a mate that has already been shown must not be shown again');
  assert.match(completion, /if \(completionKey && \(shownKeys\.has\(completionKey\) \|\| pendingKeys\.has\(completionKey\)\)\)/);
  /* Undo/redo steps through goToMove, which never asks for the card. */
  assert.match(ARENA, /function goToMove\(idx\) \{[\s\S]{0,900}?playEffectForMove\(target, 'analysis-review'/,
    'a step replays the animation');
  assert.doesNotMatch(
    ARENA.slice(ARENA.indexOf('function goToMove(idx)'), ARENA.indexOf('function goToMove(idx)') + 1200),
    /waitForMateReveal/,
    'a step must not ask for the completion card again',
  );
});
