/* Acceptance tests for the COMPACT, HORIZONTAL Play Arena result card.
 *
 * Run: node --test scripts/result-popup-redesign.test.mjs   (from frontend/)
 *
 * The card is a small white landscape sheet holding exactly three things:
 * the result (+ why it ended), both players, and the actions. Everything the
 * page used to print around that — moves, duration, clocks, time control,
 * "ended by", the New 10 min and Close buttons, and the whole move-quality
 * analysis block — must be GONE, not hidden and not merely empty.
 *
 * These are source/CSS assertions (same approach as the other popup suites):
 * the properties under test are "which content is shipped?" and "which
 * behaviour was preserved?", which are settled by reading the shipped
 * component, page and stylesheet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const board = read('src', 'pages', 'AnalysisBoard.jsx');
const popup = read('src', 'components', 'PostGameResultPopup.jsx');
const css = read('src', 'index.css');

const popupBody = popup.slice(popup.indexOf('export default function PostGameResultPopup'));
const propsMemo = board.slice(board.indexOf('const resultPopupProps = useMemo'), board.indexOf('const openResultPopup'));
const pgrCss = css.slice(css.indexOf('.pgr-overlay {'), css.indexOf('/* ============================ DARK THEME'));

/* ── 1. the light theme that was asked for ──────────────────────────────── */

test('the card is a light surface with a subtle border, soft shadow and rounded corners', () => {
  const card = pgrCss.slice(pgrCss.indexOf('.pgr-card {'), pgrCss.indexOf('}', pgrCss.indexOf('.pgr-card {')));
  assert.match(card, /background: #ffffff;/);
  assert.match(card, /border: 1px solid #e2e8f0;/);
  assert.match(card, /box-shadow:/);
  assert.match(card, /border-radius: 16px;/);
  assert.match(card, /color: #0f172a;/);
});

test('the tone accents are restrained: green win, red loss, grey draw', () => {
  assert.match(pgrCss, /\.pgr-card\.is-win \.pgr-title \{ color: #15803d; \}/);
  assert.match(pgrCss, /\.pgr-card\.is-loss \.pgr-title \{ color: #b91c1c; \}/);
  assert.match(pgrCss, /\.pgr-card\.is-draw \.pgr-hero-icon \{ background: #f1f5f9; color: #475569; \}/);
});

test('nothing loops and reduced motion is honoured', () => {
  assert.equal((pgrCss.match(/infinite/g) || []).length, 0,
    'the analysis spinner is gone, so no animation may loop');
  assert.match(pgrCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none;/);
});

/* ── 2. horizontal + compact ─────────────────────────────────────────────── */

test('the card is a horizontal grid: result | players, actions underneath', () => {
  assert.match(pgrCss, /\.pgr-card \{[^}]*display: grid;/);
  assert.match(pgrCss, /grid-template-areas:\s*\n\s*"summary players"\s*\n\s*"actions actions";/,
    'two sections side by side is what makes it landscape');
  assert.match(pgrCss, /\.pgr-summary \{[^}]*grid-area: summary;/);
  assert.match(pgrCss, /\.pgr-players \{[^}]*grid-area: players;/);
  assert.match(pgrCss, /\.pgr-actions \{[^}]*grid-area: actions;/);
});

test('the card is small: desktop ceiling, compact paddings and type', () => {
  assert.match(pgrCss, /max-width: min\(600px, calc\(100vw - 24px\)\);/,
    'about 520-600px on desktop, never wider than the phone viewport');
  assert.match(pgrCss, /max-height: calc\(100dvh - 24px\);/);
  assert.match(pgrCss, /padding: 16px 18px;/, 'compact padding, not a full sheet');
  assert.match(pgrCss, /\.pgr-title \{[^}]*font-size: 20px;/);
  assert.match(pgrCss, /\.pgr-player-avatar \{[^}]*width: 30px;[^}]*height: 30px;/,
    'small avatars keep the player block short');
});

test('the actions are one wrapping row, never a full-height footer', () => {
  const actions = pgrCss.slice(pgrCss.indexOf('.pgr-actions {'), pgrCss.indexOf('}', pgrCss.indexOf('.pgr-actions {')));
  assert.match(actions, /display: flex;/);
  assert.match(actions, /flex-wrap: wrap;/);
  assert.match(actions, /justify-content: flex-end;/);
  assert.doesNotMatch(actions, /position: sticky;/, 'the sticky footer went with the tall card');
  assert.match(pgrCss, /@media \(max-width: 640px\) \{[\s\S]*\.pgr-actions \.app-btn \{ flex: 1 1 110px; \}/,
    'on a phone the buttons wrap into equal rows instead of clipping');
});

/* ── 3. the removed content is really removed ────────────────────────────── */

test('no game statistics survive in the card or in its props', () => {
  for (const needle of [
    'Total Moves', 'Duration', 'White clock', 'Black clock',
    'Time control', 'Ended by', 'Time control',
  ]) {
    assert.ok(!popup.includes(needle), `${needle} must not be rendered`);
    assert.ok(!propsMemo.includes(needle), `${needle} must not be prepared for the card`);
  }
  assert.ok(!/details\.push/.test(board), 'the details list is gone from the page too');
  assert.ok(!/const details = \[\]/.test(board));
  assert.ok(!/pgr-details|pgr-detail\b/.test(popup));
  assert.ok(!/pgr-details|pgr-detail\b/.test(css), 'and so is its CSS');
});

test('the New 10 min and Close buttons are gone from the card', () => {
  assert.ok(!/New 10 min/.test(board), 'no action prepares a 10-minute game any more');
  assert.ok(!/New 10 min/.test(popup));
  assert.ok(!/timeOverride/.test(board), 'the override it needed is gone as well');
  assert.ok(!/>\s*Close\s*</.test(popup), 'no Close text button');
  assert.ok(!/pgr-close/.test(popup), 'no icon close button either');
  assert.ok(!/pgr-close/.test(css));
});

test('the whole Move Quality section is gone — heading, states, retry, results', () => {
  for (const needle of [
    'Move quality', 'Move-quality analysis', 'Analysing', 'Retry analysis',
    'Your result and game record are safe', 'AnalysisBlock', 'onRetryAnalysis',
    'accuracyFor', 'VERDICT_META',
  ]) {
    assert.ok(!popup.includes(needle), `the card must not render ${needle}`);
    assert.ok(!propsMemo.includes(needle), `the page must not build ${needle} for the card`);
  }
  for (const dead of [
    'pgr-analysis-state', 'pgr-analysis-title', 'pgr-analysis-sub', 'pgr-spinner',
    'pgr-accuracy', 'pgr-verdict', 'pgr-chips', 'pgr-chip', 'pgr-coach',
  ]) {
    assert.ok(!css.includes(dead), `${dead} styles a section that no longer exists`);
  }
  assert.ok(!/analysisError/.test(board),
    'the card-polling error flag went with the section');
});

test('no empty shells are left behind', () => {
  assert.ok(!/pgr-body|pgr-section|pgr-hero-text|pgr-pill/.test(popup),
    'the body/section/pill wrappers are not rendered');
  assert.ok(!/pgr-body|pgr-section|pgr-hero-text|pgr-pill/.test(css),
    'and their rules are deleted, not orphaned');
  assert.match(popupBody, /pgr-summary/);
});

/* ── 4. what the card keeps ──────────────────────────────────────────────── */

test('the headline and reason are props, never literals in the card', () => {
  assert.match(popupBody, /const headline = title \|\| 'Game over';/);
  assert.match(popupBody, /\{headline\}/);
  assert.match(popupBody, /\{displayReason\(reason\)\}/);
  assert.doesNotMatch(popupBody, /You Won!?\s*<\/h2>/, 'no hardcoded win headline');
});

test('every termination reason the game can produce is still mapped from real state', () => {
  for (const reason of [
    "'By Checkmate'", "'By Timeout'", "'By Stalemate'", "'By Threefold Repetition'",
    "'By Insufficient Material'", "'By Fifty-Move Rule'", "'By Draw'", "'By Agreement'",
  ]) {
    assert.ok(board.includes(reason), `buildResult must still produce ${reason}`);
  }
  assert.match(board, /const why = onlineReasonLabel\(onlineGame\.resultReason\);/);
  assert.match(board, /reason: why \? `By \$\{why\}` : 'Game Over'/);
});

test('both players come from real game state, one image each', () => {
  assert.match(propsMemo, /const players = \[playerFor\('white'\), playerFor\('black'\)\];/);
  assert.match(propsMemo, /winner === color \? 'Winner' : 'Loser'/);
  assert.match(propsMemo, /resultPopup\.tone === 'draw' \? 'Draw'/);
  assert.match(propsMemo, /isMe: \(live \|\| vsComputer\) && color === myColor,/);
  assert.match(popup, /import PlayerAvatar from '\.\/PlayerAvatar'/);
  assert.match(popup, /<PlayerAvatar player=\{player\.profile\} seed=\{player\.seed\} size=\{30\}/);
  assert.match(propsMemo, /const aborted = resultPopup\.title === 'Match Aborted';/);
  assert.match(propsMemo, /aborted \? null/);
});

test('a rating is shown only when the backend confirmed the game was rated', () => {
  assert.match(propsMemo, /rating: ratingResult,/,
    'the participant-scoped rating result, not the broadcast payload');
  assert.match(popup, /const rated = !!\(rating && rating\.rated && ratingNumber\(rating\.ratingBefore\) != null\);/);
  assert.ok(!/onlineGame\.ratingChange/.test(board), 'no rating is smuggled in with the game payload');
});

/* ── 5. actions ──────────────────────────────────────────────────────────── */

test('the card offers Rematch, New game and Review game — and nothing else', () => {
  assert.match(propsMemo, /if \(!inOnline && !onlineFinished && moves\.length > 0\) \{/);
  assert.match(propsMemo, /secondary\.push\(\{ label: 'Rematch', onClick: rematch, primary: true \}\);/);
  assert.match(propsMemo, /secondary\.push\(\{ label: 'New game', onClick: fullReset \}\);/);
  assert.equal((propsMemo.match(/secondary\.push\(/g) || []).length, 2,
    'only those two buttons are built for the card');

  assert.match(popupBody, /variant=\{b\.primary \? 'primary' : 'secondary'\}/);
  assert.match(popupBody, /Review game/);
  assert.match(propsMemo, /onReview: \(resultPopup\.wantsReview && moves\.length > 0\)/,
    'Review is offered only when the game can actually be reviewed');
  assert.match(popup, /onClick=\{\(\) => \{ if \(!pending\) onReview\(\); \}\}/);
});

test('one click starts at most one game', () => {
  assert.match(popupBody, /const \[pending, setPending\] = useState\(null\);/);
  assert.match(popupBody, /if \(pending\) return;/);
  assert.match(popupBody, /setPending\(null\);/);
  assert.match(popupBody, /disabled=\{Boolean\(pending\)\}/);
});

/* ── 6. preserved behaviour ──────────────────────────────────────────────── */

test('dismissing leaves the finished board, PGN and history intact', () => {
  assert.match(propsMemo, /onClose: \(\) => \{ setResultPopup\(null\); setResultDismiss\(true\); \},/);
  assert.ok(!/onClose:[\s\S]{0,120}startNewGame\(\)/.test(propsMemo),
    'closing must not reset or discard the game');
});

test('the game review still runs, it just no longer prints inside the card', () => {
  assert.match(board, /if \(finalResult\.wantsReview && moves\.length > 0 && !gameAnalysis && !analyzing\) \{/);
  assert.match(board, /runGameAnalysis\(true\);/);
  assert.match(board, /import \{ analyzeGame, accuracyFor, VERDICT_META \} from '\.\.\/utils\/gameAnalysis';/,
    'the canonical review engine is still imported for the review surfaces');
  assert.match(propsMemo, /goToGameReview\(\)/);
});

test('the popup opens once per finished game, after the mate animation', () => {
  assert.match(board, /const key = `\$\{finalResult\.title\}-\$\{finalResult\.reason\}-\$\{moves\.length\}`;/);
  assert.match(board, /if \(resultSeenRef\.current === key\) return;/);
  assert.match(board, /open=\{!resultDismiss && !resultRevealPending\}/);
});

test('the dialog is accessible and dismissible without a Close button', () => {
  assert.match(popupBody, /role="dialog"/);
  assert.match(popupBody, /aria-modal="true"/);
  assert.match(popupBody, /aria-labelledby="pgr-title"/);
  assert.match(popupBody, /id="pgr-title"/);
  assert.match(popup, /useOverlayHistory\('post-game-result', open, onClose\);/,
    'the browser Back button closes it');
  assert.match(popup, /onClick=\{onClose\}/, 'the backdrop closes it');
  assert.match(popup, /if \(e\.key === 'Escape'\) closeRef\.current\?\.\(\);/,
    'Escape closes it for keyboard users');
  assert.match(propsMemo, /onClose:/);
});
