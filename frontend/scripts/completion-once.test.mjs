/* Completion card is shown once per game.
 *
 * Run: node --test scripts/completion-once.test.mjs
 *
 * Undo/redo (or a repeated onFinish for the same mate) replays the animation
 * but must never show the card again. The flag is only reset by a new game id
 * or an explicit rematch / new game.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

test('BotGamePage shows the completion card once per game id', () => {
  const bot = src('pages/BotGamePage.jsx');
  assert.match(bot, /const completionShownRef = useRef\(null\);/);
  assert.match(bot, /if \(completionShownRef\.current === gameKey\) \{/);
  assert.match(bot, /completionShownRef\.current = gameKey;/);
  assert.match(bot, /key: `bot:\$\{gameKey\}`/);
  // reset only on a real new game
  assert.equal((bot.match(/completionShownRef\.current = null;/g) || []).length, 2,
    'rematch and swap-and-restart clear the flag');
});

test('AnalysisBoard shows the ONE completion card once per game', () => {
  const board = src('pages/AnalysisBoard.jsx');
  /* There is ONE card now: the PostGameResultPopup, used by the page board and
     by the Play Mode board alike. */
  assert.match(board, /<PostGameResultPopup/);
  assert.match(board, /open=\{!resultDismiss && !resultRevealPending\}/,
    'the card waits for the checkmate animation and can be dismissed');
  assert.match(board, /\{!playMode && resultCard\}/,
    'the page shows the same card the Play Mode board shows');
  /* The "once per game" guard lives with the reveal key in the effect layer, so
     it applies to every surface that waits for the mate animation. */
  const completion = src('effects/moveEffect/completion.js');
  assert.match(completion, /shownKeys\.has\(completionKey\)/,
    'a mate that has already been shown must not be shown again');
  assert.match(completion, /pendingKeys\.has\(completionKey\)/);
});

test('a brilliant move never shows a text bubble', () => {
  const cheer = src('components/CelebrationFX.jsx');
  const feedback = src('components/puzzle/MoveFeedbackOverlay.jsx');
  assert.doesNotMatch(cheer, /'Brilliant!'/);
  assert.doesNotMatch(feedback, /'Brilliant!'/);
});

test('checkmate popup is anchored to the mated king and is tunable', () => {
  const cfg = src('effects/moveEffect/config.js');
  const fx = src('effects/moveEffect/MoveEffect.jsx');
  assert.match(cfg, /export const CHECKMATE_POPUP_AT_MS = 600;/);
  assert.match(fx, /CHECKMATE_POPUP_AT_MS/);
  assert.match(fx, /const kingPt = squarePoint\(effect\?\.kingSquare \|\| effect\?\.to, orientation\)/);
  assert.match(fx, /className="me-checkmate"/);
  assert.match(fx, /showCheckmatePopup && effect\?\.type === 'checkmate'/);
});
