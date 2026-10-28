// Regression tests for the post-game rating change -
  //   run with: node --test scripts/rated-result.test.mjs   (from frontend/)
  //
  // A finished rated PLAYER-VS-PLAYER game must show "you gained/lost N".
  // Bot games must show nothing at all.
  //
  // Two properties are easy to break and are asserted here:
  //  1. Bot games are never rated. There is no honest number to show, so the
  //     popup must render no rating line rather than a fabricated or zero delta.
  //     (A bot has no student row; onlineController.applyOnlineRating returns
  //     early on row.is_bot.)
  //  2. The delta must come from its own participant-scoped request, NOT from the
  //     game payload. emitGameUpdate broadcasts {forAdmin, forStudent} to BOTH
  //     sockets, so a rating travelling with the game state would hand each
  //     player the opponent's rating change.
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { dirname, join } from 'node:path';

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
  const popup = readFileSync(join(ROOT, 'src', 'components', 'PostGameResultPopup.jsx'), 'utf8');
  const online = readFileSync(join(ROOT, 'src', 'utils', 'online.js'), 'utf8');
  const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

  test('the popup renders a rating line only when the game was rated', () => {
    assert.match(popup, /rating && rating\.rated &&/,
      'the rating block must be gated on rated, so an unrated game shows nothing');
    assert.match(popup, /if \(n > 0\) return <span className="pgr-delta is-up"/,
      'a gain must be signed with + and marked as an up move');
    assert.match(popup, /is-up[\s\S]{0,140}is-down/,
      'gain and loss must be visually distinguished');
    assert.match(popup, /\{rating\.ratingBefore\}[\s\S]{0,220}\{rating\.ratingAfter\}/,
      'show before -> after so the delta is checkable by eye');
  });

  test('each player row shows its OWN rating movement', () => {
    const row = popup.slice(popup.indexOf('function PlayerRow'), popup.indexOf('function AnalysisBlock'));
    assert.match(row, /const mine = rated && player\.isMe;/,
      'my row reads the participant-scoped numbers');
    assert.match(row, /const theirs = rated && !player\.isMe && rating\.opponent;/,
      'the opponent row needs its own object, never a copy of mine');
    assert.match(row, /\{rating\.opponent\.ratingBefore\}/,
      'the opponent before-rating comes from rating.opponent');
    assert.match(row, /<RatingDelta value=\{rating\.opponent\.ratingChange\}/,
      'the opponent delta comes from rating.opponent');
  });

  test('the rating is fetched per game, and only for real online matches', () => {
    assert.match(src, /if \(onlineFinished && onlineGame\?\.id\)/,
      'the fetch must be limited to a finished online match');
    assert.match(src, /fetchRatingResult\(gameId\)/,
      'the popup must ask the participant-scoped endpoint');
    /* bot games never take that branch, and must be actively cleared */
    assert.match(src, /\} else if \(!onlineFinished\) \{\s*setRatingResult\(null\);/,
      'leaving an online game must clear a stale rating');
  });

  test('the delta never travels with the shared game payload', () => {
    /* The privacy property. If a ratingChange were ever read off onlineGame,
     * it would have come through the broadcast both players receive. */
    assert.ok(!/onlineGame\.ratingChange/.test(src),
      'reading the delta off the game payload would expose the opponent rating');
    assert.match(online, /export async function fetchRatingResult/,
      'a dedicated endpoint must exist');
    assert.match(online, /rating-result`/, 'it must hit the rating-result route');
    assert.match(online, /cache: false/,
      'the answer changes once the game is rated; a cached answer would leave '
      + 'the popup showing nothing');
  });

  test('the rating line is styled, not left unstyled', () => {
    for (const sel of ['.pgr-player-rating {', '.pgr-delta.is-up', '.pgr-delta.is-down']) {
      assert.ok(css.includes(sel), `missing CSS: ${sel}`);
    }
  });