import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/Leaderboard.jsx', 'utf8');
const modal = readFileSync('src/components/LeaderboardCompareModal.jsx', 'utf8');
const podium = readFileSync('src/components/ChampionsPodium.jsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

/* ── Entry point ───────────────────────────────────────────────────────────
   Every student row/card but your own carries the action; a coach never sees
   one, because "you" has no ladder identity in that view. */
test('Compare is student-only and every other row gets a button', () => {
  assert.match(page, /import LeaderboardCompareModal from '\.\.\/components\/LeaderboardCompareModal'/);
  assert.match(page, /const canCompare = user\?\.role === 'student'/);

  // ELO table and Champion table each render the action cell, and the button is
  // skipped only on the viewer's own row.
  const cells = page.match(/className="lb-cmp"/g) || [];
  const champCells = page.match(/className="champ-cmp"/g) || [];
  assert.ok(cells.length >= 1, 'the ELO table has a Compare cell');
  assert.ok(champCells.length >= 1, 'the Champion table has a Compare cell');
  const selfGuards = page.match(/Number\(r\.user_id\) !== Number\(user\?\.id\)/g) || [];
  assert.ok(selfGuards.length >= 2, 'both tables skip the viewer row');
  assert.match(page, /lb-cmp-btn[\s\S]*?onClick=\{\(\) => openCompare\(r\.user_id\)\}/);

  // The podium cards are handled by ChampionsPodium; the page opts in.
  assert.match(page, /onCompare=\{canCompare \? \(p\) => openCompare\(p\.user_id\) : undefined\}/);
  assert.match(podium, /onCompare = null,\s*\n\s*compareMeId = null/);
  assert.match(podium, /onCompare && Number\(p\.user_id\) !== Number\(compareMeId\)/);
  assert.match(podium, /lb-pcard-compare/);
});

test('clicking a row opens the sheet on that student', () => {
  assert.match(page, /setCompareId\(Number\(id\)\);\s*\n\s*setCompareOpen\(true\)/);
  assert.match(page, /<LeaderboardCompareModal/);
  assert.match(page, /open=\{compareOpen\}/);
  assert.match(page, /onClose=\{\(\) => setCompareOpen\(false\)\}/);
  assert.match(page, /students=\{isChampion \? champRows : ranked\}/);
  assert.match(page, /me=\{user\}/);
  assert.match(page, /initialOpponentId=\{compareId\}/);
});

/* ── The sheet ──────────────────────────────────────────────────────────── */
test('the sheet loads the compare endpoint and can swap the opponent', () => {
  assert.match(modal, /api\.get\(`\/leaderboard\/compare\/\$\{id\}`, \{ cache: false \}\)/);
  assert.match(modal, /<label className="cmp-picker-label"[\s\S]*?Compare with/);
  // The picker never offers you yourself.
  assert.match(modal, /if \(!id \|\| id === myId \|\| seen\.has\(id\)\) continue;/);
});

test('every requested stat and the head-to-head are rendered', () => {
  for (const label of [
    'Games played', 'Wins', 'Losses', 'Draws', 'Win rate', 'Current streak',
    'Puzzles solved', 'Puzzle rating', 'Accuracy', 'Last 5 games',
  ]) {
    assert.ok(modal.includes(`label="${label}"`) || modal.includes(`>${label}<`), `${label} row`);
  }
  assert.match(modal, /mine\.wins/);
  assert.match(modal, /mine\.losses/);
  assert.match(modal, /mine\.draws/);
  assert.match(modal, /mine\.winRate/);
  assert.match(modal, /mine\.streak/);
  assert.match(modal, /mine\.puzzlesSolved/);
  assert.match(modal, /mine\.puzzlePoints/);
  assert.match(modal, /mine\.accuracy/);
  assert.match(modal, /mine\.lastGames/);

  // Head-to-head contract from the endpoint.
  assert.match(modal, /h2h\.myWins/);
  assert.match(modal, /h2h\.opponentWins/);
  assert.match(modal, /h2h\.draws/);
  assert.match(modal, /h2h\.winRate/);
  assert.match(modal, /h2h\.lastGames\.map/);
  // Colour played and the date are both listed per game.
  assert.match(modal, /game\.color \? `\$\{game\.color === 'white' \? 'White' : 'Black'\} pieces`/);
  assert.match(modal, /shortDate\(game\.date\)/);
});

test('empty, loading and failure states exist', () => {
  assert.match(modal, /Inum indha rendu perum game aadala\./);
  assert.match(modal, /function Skeleton\(/);
  assert.match(modal, /className="cmp-error" role="alert"/);
  assert.match(modal, />\s*Try again\s*</);
  assert.match(modal, /Pick a student above to see the comparison\./);
});

test('the better value is the only one highlighted', () => {
  // Higher wins, except for Losses where the lower number is better.
  assert.match(modal, /betterOf\(mine\.losses, theirs\.losses, 'low'\)/);
  assert.match(modal, /cmp-val--win/);
  // Draws are neutral: no better flag is computed for them.
  assert.match(modal, /label="Draws"\s*\n\s*mine=\{mine\.draws\}\s*\n\s*theirs=\{theirs\.draws\}\s*\n\s*\/>/);
});

/* ── Layout ──────────────────────────────────────────────────────────────── */
test('the Compare column has a complete grid template at every breakpoint', () => {
  const cmpTemplates = css.match(/\.lb-grid--cmp \{[^}]*grid-template-columns:[^}]*\}/g) || [];
  assert.equal(cmpTemplates.length, 5, 'base, 900, 700, 540 and 430 each declare one');
  const champTemplates = css.match(/\.champ-grid--cmp \{[^}]*grid-template-columns:[^}]*\}/g) || [];
  assert.equal(champTemplates.length, 3, 'base, 900 and 700 each declare one');
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?grid-template-areas: "rank who score" "metrics metrics cmp";/);
});

test('the sheet becomes a full-screen, internally-scrolling sheet on a phone', () => {
  assert.match(css, /\.mz-modal\.cmp-modal \{[^}]*width: min\(760px/);
  assert.match(css, /\.mz-modal-layer\.cmp-layer \{ padding: 0; align-items: stretch; \}/);
  assert.match(css, /\.mz-modal\.cmp-modal \{[\s\S]*?height: 100dvh;[\s\S]*?border-radius: 0;/);
  // The shared modal already scrolls its body; the page itself never scrolls.
  assert.match(css, /\.mz-modal-body \{[^}]*overflow-y: auto;/);
});

test('result chips carry a colour per outcome', () => {
  assert.match(css, /\.cmp-result--w \{ background: #dcfce7; color: #15803d; \}/);
  assert.match(css, /\.cmp-result--l \{ background: #fee2e2; color: #b91c1c; \}/);
  assert.match(css, /\.cmp-result--d \{ background: #e2e8f0; color: #475569; \}/);
});
