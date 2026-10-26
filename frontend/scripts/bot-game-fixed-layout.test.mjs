/**
 * The bot game screen must never scroll the page.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `useBoardWidth` computed `Math.min(max, window.innerWidth - pad)` — it only
 * ever looked at viewport WIDTH. But a board is not `boardWidth` tall: ChessBoard
 * wraps the square in a themed frame whose band is `clamp(round(width * 0.082),
 * 20, 46)` on each side, plus frame padding and a notation row. A 530px board
 * needs roughly 655px of column height.
 *
 * The page root was `min-h-screen`, so on any window shorter than that column
 * the page grew past the viewport and scrolled — the post-game screen ended up
 * with a scrollbar, which is what a fixed game screen must never have.
 *
 * These assertions pin the three independent things that had to be true at once,
 * because fixing only one of them still leaves a scrollbar:
 *
 *   1. the page is exactly viewport height and clips, so it cannot scroll
 *   2. the flex children may shrink (`min-h-0`), so the panel scrolls internally
 *      instead of pushing the page taller
 *   3. the board is fitted on BOTH axes, so it fits rather than overflowing
 *
 * Run with: npm run test:bot-game-fixed
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(ROOT, 'src', 'pages', 'BotGamePage.jsx'), 'utf8');
const hook = readFileSync(join(ROOT, 'src', 'hooks', 'useBoardWidth.js'), 'utf8');
const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');

/* Structural checks run against comment-stripped source.
 *
 * The fixes are documented in comments that QUOTE the very classes being
 * forbidden ("`min-h-screen` is the specific bug", "NOT `items-center`"), so a
 * plain text search finds the string it is asserting is gone. Only block comments
 * are stripped, and they cannot appear inside a string literal in this file. */
const code = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

test('the page root is viewport height and cannot scroll', () => {
  assert.match(
    code,
    /className="flex h-screen flex-col overflow-hidden[^"]*"/,
    'the game screen root must be h-screen + overflow-hidden, not min-h-screen',
  );

  /* `min-h-screen` is the specific bug on the GAME screen: it permits the page
     to grow past the viewport. It must appear nowhere else except the
     not-found fallback, which is an ordinary short page where scrolling is
     correct - so the count is pinned rather than the string banned outright. */
  const minScreen = code.match(/min-h-screen/g) || [];
  assert.equal(
    minScreen.length,
    1,
    `min-h-screen must appear only in the not-found state, found ${minScreen.length}`,
  );
  assert.match(
    code,
    /function BotNotFound[\s\S]{0,900}?min-h-screen/,
    'the one remaining min-h-screen belongs to the not-found fallback',
  );
});

test('both flex children can shrink, so the panel scrolls internally', () => {
  /* A flex item will not shrink below its content without min-h-0. Without it
     the aside's content height becomes the row height and the page scrolls. */
  const aside = code.match(/<aside[^>]*className="([^"]*)"/);
  assert.ok(aside, 'the panel <aside> must exist');
  assert.match(aside[1], /\bmin-h-0\b/, 'the panel needs min-h-0 to shrink');

  const area = code.match(/ref=\{areaRef\}[\s\S]{0,400}?className="([^"]*)"/);
  assert.ok(area, 'the board area must exist');
  assert.match(area[1], /\bmin-h-0\b/, 'the board area needs min-h-0 to shrink');
});

test('the panel keeps its own internal scrolling', () => {
  /* The content that overflows (chat, moves, result panel) must scroll inside
     the panel, not move the page. */
  assert.match(code, /play-mode-panel-scroll/, 'the scrollable panel region is still used');
});

test('the board is fitted on both axes, not width alone', () => {
  assert.match(code, /useFittedSquare/, 'the page must use the two-axis fitter');
  assert.match(
    code,
    /useFittedSquare\(\{ max: 530/,
    'the 530px cap the player asked for must be preserved',
  );
  /* The width-only sizer must be gone from this page: it is the root cause. */
  assert.doesNotMatch(
    code,
    /useBoardWidth\(530\)/,
    'the width-only sizer is what let the board overflow vertically',
  );
});

test('the fitter reads BOTH axes and subtracts the measured frame overhead', () => {
  assert.match(hook, /export function useFittedSquare/);
  /* Width AND height of the container must both feed the solve. */
  assert.match(hook, /availW\s*=/, 'available width is measured');
  assert.match(hook, /availH\s*=/, 'available height is measured');
  assert.match(hook, /Math\.min\(availW,\s*Math\.max\(0,\s*availH\s*-\s*overhead\)\)/s,
    'the solve must use both axes, with the overhead removed from the height');
  /* The overhead has to be measured, not guessed from constants. */
  assert.match(hook, /overhead/, 'frame overhead is accounted for');
  /* Both measurement refs must actually be wired up in the page. */
  assert.match(code, /ref=\{areaRef\}/, 'areaRef is attached to the padded container');
  assert.match(code, /ref=\{fitRef\}/, 'fitRef is attached to the board-sized child');
});

test('the fitter reacts to layout changes, not only window resizes', () => {
  /* The result panel opening changes the available height without any window
     resize firing, so a resize listener alone would leave the board oversized. */
  assert.match(hook, /ResizeObserver/, 'container size changes must be observed');
  assert.match(hook, /addEventListener\('resize'/, 'window resize must be handled');
});

test('the fitter cannot loop through renders', () => {
  /* `size` is a dependency (the overhead is measured against the rendered
     board), so the commit must be a no-op once it settles or the effect would
     re-trigger itself forever. */
  assert.match(hook, /setSize\(\(prev\)\s*=>/, 'size updates go through a functional guard');
  assert.match(hook, /Math\.abs\(prev\s*-\s*next\)\s*>=\s*1/, 'sub-pixel changes are ignored');
});

test('the navbar stands down on the full-screen game route', () => {
  /* THE ACTUAL SCROLL CAUSE, and the reason a page-level `h-screen` fix was not
     enough on its own.
     
     `App.jsx` decides whether to render the public <Navbar /> with:
       isBare || isOpeningsModule ? null : isAdmin || isStudent ? null : <Navbar />
     `isStudent` is true only for `/student*` and `/live-class*`, so `/play/bot/:id`
     matched NONE of the branches and fell through to the navbar. That header is
     `sticky` and IN FLOW (~65px), sitting above the route container that holds a
     100vh page - so the document became navbar + 100vh and scrolled, however
     correctly the page itself was sized. The board fitter sizes to 100vh, which
     is only right if nothing else claims height. */
  assert.match(app, /const isFullScreenGame = location\.pathname\.startsWith\('\/play\/bot\/'\)/,
    'the full-screen game route must be detected');
  assert.match(
    app,
    /isBare \|\| isOpeningsModule \|\| isFullScreenGame \? null/,
    'the navbar condition must stand the navbar down for it',
  );
});

test('the navbar is kept on the bot catalogue, which is ordinary browsing', () => {
  /* `/play/bots` must NOT be caught by the full-screen rule. The trailing slash is
     the only thing separating the two paths, so it is asserted directly rather
     than assumed - losing it would strip the navbar off the catalogue. */
  const prefix = app.match(/const isFullScreenGame = location\.pathname\.startsWith\('([^']+)'\)/);
  assert.ok(prefix, 'the prefix literal must be readable');
  assert.equal(prefix[1], '/play/bot/', 'the prefix must keep its trailing slash');

  const starts = (p) => p.startsWith(prefix[1]);
  assert.equal(starts('/play/bot/pip'), true, 'a bot match is full screen');
  assert.equal(starts('/play/bot/leo?tc=5min'), true, 'query strings included');
  assert.equal(starts('/play/bots'), false, 'the catalogue keeps its navbar');
  assert.equal(starts('/play/bots/anything'), false, 'and any sub-path');
});

test('the width solve counts the frame, not just the bare square', () => {
  /* The 360px-phone bug: the height solve fitted a 280px board, but ChessBoard
     renders board PLUS its themed frame, so the framed board stuck out past the
     viewport sideways. The width cap must solve board + frame against the
     container width, and the final size is the smaller of the two solves. */
  assert.match(hook, /framedWidth/, 'board + frame width is computed');
  assert.match(hook, /framedWidth\(wCap\) > availW/, 'the cap walks down until it fits');
  assert.match(hook, /Math\.min\(nextH,/s, 'height and width solves combine by taking the smaller');
});

test('the board wrapper is content-sized, not bare-board width', () => {
  /* The right-edge cut on phones: the wrapper was styled width:boardWidth while
     its content is board PLUS frame, so the framed board hung past the wrapper
     and the excess clipped on the right. Sizing to the content (capped at the
     container) centres the whole framed board instead of just the square. */
  assert.doesNotMatch(code, /style=\{\{\s*width:\s*boardWidth\s*\}\}/,
    'the wrapper must not be pinned to the bare board width');
  const fit = code.match(/ref=\{fitRef\}[\s\S]{0,200}?className="([^"]*)"/);
  assert.ok(fit, 'the board wrapper must exist');
  assert.match(fit[1], /w-fit/, 'the wrapper shrinks to the framed board');
  assert.match(fit[1], /max-w-full/, '...but never past its container');
});

test('a board below the floor scrolls rather than shrinking to nothing', () => {
  /* Shrinking without limit would produce an unplayable board; clipping would
     hide the controls. The floor plus a scrollable area is the honest
     compromise, so both must be present. */
  assert.match(hook, /min = 280/, 'a sane floor is defined');
  assert.match(code, /min: 280/, 'the page opts into that floor');
  assert.match(hook, /Math\.max\(min,/, 'the floor is actually applied');

  /* And that safety valve must not use align-items:center, which clips the
     start edge of an overflowing item so it cannot be scrolled to. */
  const area = code.match(/ref=\{areaRef\}[\s\S]{0,400}?className="([^"]*)"/);
  assert.ok(area, 'the board area must exist');
  assert.doesNotMatch(area[1], /items-center/, 'items-center clips unreachable overflow');
  assert.match(area[1], /items-start/, 'use items-start so overflow stays scrollable');
  assert.match(code, /my-auto/, 'the child re-centres itself with auto margins');
});