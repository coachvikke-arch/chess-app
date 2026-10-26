// Wiring test for the optional post-game analysis on bot games
// (frontend/src/pages/BotGamePage.jsx) —
//   run with: node --test scripts/bot-postgame.test.mjs   (from frontend/)
//
// Bot games previously stopped at a plain "You win!" banner, while the Arena
// board (AnalysisBoard.jsx) already had move-quality grades + coach feedback.
// This guards the reuse of that existing machinery rather than a new one:
//   1. `analyzeGame` runs once per finished game, and never for an unfinished or
//      empty game (a 0-move "loss" has nothing to grade).
//   2. The popup does NOT auto-open (it used to stack a second result card over
//      the inline panel); REMATCH/SWAP must still close it if opened manually,
//      otherwise the result modal survives into the new game.
//   3. Dismissing the popup must NOT clear the result: the inline panel and the
//      coins stay readable, and the popup can be reopened.
//   4. "Game Review" must navigate statelessly via ?pgn= — bot games are never
//      written to game history, so there is no saved id to look up.
//   5. No chess-rating delta may be shown: a bot has no real rating. The panel
//      shows the honest Bot Coin balance movement instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', 'pages', 'BotGamePage.jsx'), 'utf8');

const sliceFrom = (needle, len = 1400) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `expected to find ${JSON.stringify(needle)}`);
  return src.slice(i, i + len);
};

test('post-game analysis reuses the existing arena machinery', () => {
  assert.match(src, /from '\.\.\/components\/PostGameResultPopup'/, 'the shared result popup is not reused');
  assert.match(src, /import \{ analyzeGame, buildCoachMessage \} from '\.\.\/utils\/gameAnalysis'/, 'gameAnalysis helpers are not reused');
  /* A second, bot-only copy of the grading UI would drift from the Arena one. */
  assert.doesNotMatch(src, /pgr-card/, 'BotGamePage re-implements the popup markup instead of reusing it');
});

test('analysis is skipped unless the game actually finished with moves', () => {
  const effect = sliceFrom('/* Grade the finished game once.', 1500);
  assert.match(effect, /if \(!outcome \|\| sanMoves\.length === 0\) return/, 'analysis must not run before the result or with no moves');
  /* One run per distinct game: rematch must re-grade, not re-open the old run. */
  assert.match(effect, /const token = \+\+analysisToken\.current/, 'no run token, so a stale run can write into a rematch');
  assert.match(effect, /analyzeGame\('start', sanMoves/, 'the graded moves must be the SAN history');
});

test('the popup stays shut on game end and is closed by every restart path', () => {
  /* The inline panel is the single result surface; auto-opening the modal made
     two stacked result cards. Manual reopen must keep working. */
  assert.doesNotMatch(
    src,
    /if \(outcome && !popupDismissed\) setPopupOpen\(true\)/,
    'the result popup must not auto-open on game end',
  );
  assert.match(
    src,
    /onReopen=\{\(\) => setPopupOpen\(true\)\}/,
    'the inline panel must still offer the popup back',
  );
  /* Both restart paths must clear the modal, or it hangs over the new game.
     Matched on the declaration through to the closing `);` rather than on a
     literal `[game]` dep list, since these callbacks legitimately depend on
     more than the game hook (the clock reset). */
  const restarts = src.match(/const (?:startOver|swapAndRestart) = useCallback\([\s\S]*?\n\s*\}, \[[^\]]*\]\);/g) || [];
  assert.equal(restarts.length, 2, 'expected startOver and swapAndRestart');
  for (const fn of restarts) {
    assert.match(fn, /setPopupOpen\(false\)/, `${fn.slice(0, 14)} does not close the result popup`);
    assert.match(fn, /setOutcome\(null\)/, `${fn.slice(0, 14)} does not clear the result`);
    /* A rematch must also restart the clocks, otherwise the new game inherits
       whatever was left on the clock and the flag latch stays closed. */
    assert.match(fn, /restartClock\(\)/, `${fn.slice(0, 14)} does not reset the clocks`);
  }
  assert.match(
    src,
    /const restartClock = useCallback\([\s\S]*?timer\.reset\(/,
    'restartClock must call timer.reset()',
  );
});

test('dismissing the popup keeps the result and offers a way back', () => {
  const panel = sliceFrom('function ResultPanel(', 2200);
  assert.match(panel, /canReopen/, 'the inline panel cannot reopen the popup');
  assert.match(panel, /outcome\.coinsEarned/, 'the coins line is dropped from the inline panel');
  /* onClose must dismiss, not clear the result: `onClose={() => { setPopupOpen(false); setPopupDismissed(true); }}` */
  assert.match(
    src,
    /onClose=\{\(\) => \{ setPopupOpen\(false\); setPopupDismissed\(true\); \}\}/,
    'closing the popup must dismiss it rather than clear the game result',
  );
});

test('Game Review is stateless, and only honest coin movement is shown', () => {
  const review = sliceFrom('/* Full Game Review is stateless here', 900);
  assert.match(review, /pgn=\$\{encodeURIComponent\(pgn\)\}/, 'review must pass the live PGN');
  assert.match(review, /`\/student\/review\$\{query\}`/, 'review must navigate to /student/review');
  /* Bot games are never saved to game history, so there is no id to append. */
  assert.doesNotMatch(review, /id=\$\{/, 'review must not look up a saved game id for a bot game');
  /* `rating` is omitted entirely: the popup renders nothing without it, and a
     bot has no chess rating to invent. The inline panel shows the real Bot
     Coin balance movement (before → after) instead. */
  assert.doesNotMatch(src, /\brating=\{/, 'a rating block must not be passed for a bot game');
  const panel = sliceFrom('function ResultPanel(', 3200);
  assert.match(panel, /Bot Coins /, 'the panel must show the coin balance movement');
  assert.match(panel, /outcome\.coinsTotal/, 'before → after needs the stored total');
  assert.match(panel, /BotAvatar/, 'the panel must name the bot side with its avatar');
  assert.match(panel, /onReview/, 'the panel must keep a Review action now the popup stays shut');
});

test('move grades are read for the player side and zero rows are dropped', () => {
  const stats = sliceFrom('const popupStats = useMemo(', 1300);
  assert.match(stats, /analysis\?\.counts\?\.\[playerColor\]/, 'grades must be filtered to the player side');
  assert.match(stats, /\.filter\(\(s\) => s\.count > 0\)/, 'zero-count verdicts must be hidden');
  /* Grading the bot's moves as if they were the player's would be a real bug. */
  assert.doesNotMatch(stats, /counts\?\.\[botColor\]/, 'the bot side must not be graded as the player');
});