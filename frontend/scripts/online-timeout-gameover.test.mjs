// Regression test for "handle a clock running out like chess.com" in the Play
// Arena — Online Match and vs Computer alike.
//   run with: node --test scripts/online-timeout-gameover.test.mjs   (from frontend/)
//
// REQUIREMENT (user): when a player's clock reaches 0:00 the game ends
// IMMEDIATELY and that player LOSES; "the server must be the source of truth (not
// only the client timer)"; it must also end when the player on 0:00 has
// disconnected or closed the app; a flag against a side with nothing to mate with
// is a DRAW. The board then locks, both clocks stop, the fallen clock stays red,
// the result joins the move list, and one card tells each player what happened to
// THEM.
//
// The server's half is pinned by backend/scripts/online-clock-settlement.test.mjs,
// which drives the real controller against a stub database and never needs one.
// This file pins the page: what it asks for, what it is allowed to believe, and
// what it then shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Chess } = require('chess.js');
const page = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const backend = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'onlineController.js'), 'utf8');
const server = readFileSync(join(ROOT, '..', 'backend', 'server.js'), 'utf8');

/* The source lines from the one holding `start` through the first later line
   holding `end`. Slicing beats a whole-file regex here: this feature spans a
   comment, an effect and a callback, and a [\s\S]* wide enough to reach all of
   them matches half the page by accident. */
function blockIn(src, start, end) {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l.includes(start));
  assert.ok(from > -1, `no line contains ${JSON.stringify(start)}`);
  const to = lines.findIndex((l, i) => i >= from && l.includes(end));
  assert.ok(to > from, `${JSON.stringify(end)} never follows ${JSON.stringify(start)}`);
  return lines.slice(from, to + 1).join('\n');
}
const block = (start, end) => blockIn(page, start, end);

/** The single source line containing `needle`, trimmed. */
function line(src, needle) {
  const hits = src.split('\n').map((l) => l.trim()).filter((l) => l.includes(needle));
  assert.equal(hits.length, 1,
    `expected exactly one line with ${JSON.stringify(needle)}, found ${hits.length}`);
  return hits[0];
}

/** Run an extracted pure helper for real. `src` is a block that starts at the
    function and trails into whatever follows it, so the body is the slice up to
    its last closing brace. */
function evalRule(src) {
  const body = src.slice(0, src.lastIndexOf('}') + 1);
  // eslint-disable-next-line no-eval
  return eval(`(${body})`);
}

const claimEffect = block('if (!inOnline || !clockRunning || !clock) return undefined;',
  '}, [inOnline, clockRunning, clock]);');const claimFn = block('async function flagOnlineCurrent(gameIdArg) {', 'function openOnline(m)');
const botFlag = block('/* computer flag-fall */', '}, [computerOn, clockRunning, computerColor, clock?.turn]);');
const boardLock = block('const gameOver = onlineFinished', 'const boardLive = boardInteractive && !waitingForOpponent;');
const resultToken = block('const endWord = onlineFinished', "].filter(Boolean).join(' · ');");

/* ── 1. the page reports a clock; the server rules on it ─────────────────── */
test('a clock that hits zero is reported to the server, never settled locally', () => {
  /* The watch reads the SAME pure helper the clock box displays from, so what a
     player sees at 0:00 is exactly what the page claims — and no second copy of
     the countdown can disagree with the first. */
  assert.match(claimEffect, /if \(remainingMs\(clock, true, color\) > 0\) return;/,
    'the flag check is the display reading, not another calculation');
  /* Whichever side is ON the clock triggers the claim. The opponent is the one
     owed the win, and they are the one still looking at the board. */
  assert.match(claimEffect, /const color = clock\.turn;/,
    'the checked colour is whoever is on the clock, not whoever I am');
  assert.doesNotMatch(claimEffect, /onlineMyColor/,
    'and the check is never filtered down to the page side of the board');

  /* Nothing in the claim path computes a result, a winner or a reason. All of it
     arrives in the row the server sends back. */
  assert.doesNotMatch(claimEffect, /winner|result|checkmate|resign/i,
    'the page cannot name an outcome — it only reports the clock');
  assert.match(claimFn, /const row = await timeoutGame\(gameId\);\n\s*applyOnline\(row\)/,
    'the reply is applied as any other server row, so the finish travels the proven path');
  assert.match(claimFn, /gameIdArg \?\? onlineGame\?\.id/,
    'the id is taken at call time, so a claim cannot land on a match already left behind');
});

test('a refused claim is asked again, and a settled game is never asked twice', () => {
  assert.match(line(page, 'const FLAG_RETRY_MS = 2000;'), /= 2000;/);
  assert.match(claimEffect, /Date\.now\(\) - claim\.attemptedAt < FLAG_RETRY_MS/,
    'a refusal retries after the floor instead of latching forever');
  assert.match(claimEffect, /setInterval\(check, 250\)/,
    'the watch owns its interval — the page no longer ticks five times a second');
  /* The latch is per game, so a rematch starts clean and an old settled claim
     cannot silence a new flag. */
  assert.match(claimEffect, /String\(claim\.gameId\) === String\(onlineGame\.id\)/);
  assert.match(claimEffect, /claim\.settled/, 'a claim the server accepted is not repeated');
  assert.match(line(page, 'flagClaimRef.current = { gameId: gid, settled: false, attemptedAt: Date.now() };'),
    /settled: false/, 'a fresh claim starts un-latched');

  /* Which answer means which. */
  assert.match(line(page, 'if (status === 409) return false;'), /return false/,
    '409 = the server clock had not crossed zero yet: ask again');
  assert.match(line(page, 'if (status === 403 || status === 404) return true;'), /return true/,
    'a claim that can never succeed stops asking');
  assert.match(claimFn, /await catchUpOnline\(gameId\);/,
    'anything else reads the row back — the GET settles an expired clock on the way out');
  assert.match(line(page, "return onlineGameRef.current?.status !== 'active';"), /!== 'active'/,
    'and the retry stops only once the row really is finished');
});

test('the sweep is the server\u2019s, so a disconnected player still loses on time', () => {
  /* The case with no request in it: the flagged player closed the app and the
     opponent is only watching. Nothing a browser does can settle that. */
  assert.match(server, /startOnlineClockWorker\(io\)/, 'the API starts it when it boots');
  assert.match(backend, /exports\.startOnlineClockWorker = \(io\) =>/, 'and the controller owns it');
  /* Every path that reads the match settles it first, so a player who refreshes
     onto a dead board gets the result on the very first request. */
  const settles = backend.match(/await finishOnFlag\(row/g) || [];
  assert.equal(settles.length, 4,
    `claim, read, spectate and move must all settle — found ${settles.length}`);
});

/* ── 2. the bot game, which has no server clock to ask ───────────────────── */
test('a fallen clock is pinned at 0:00 instead of its last snapshot', () => {
  const zero = block('function zeroFlaggedClock(color) {', 'function drawOnFlag(winnerColor) {');
  assert.match(zero, /setClock\(\(c\) => \(c/, 'written into state, not merely displayed');
  assert.match(zero, /\[color === 'white' \? 'whiteMs' : 'blackMs'\]: 0/);
  /* The low-time suite pins the exact number of stop-the-clock calls, so the
     helper that writes the zero must not be a second place that stops it. */
  assert.doesNotMatch(zero, /setClockRunning/, 'stopping stays the flag branch alone');

  /* Both directions of the bot flag pin their own loser before announcing it. */
  const botLoss = block('if (clock?.turn === bot && liveRemaining(bot) <= 0) {', 'return;');
  const humanLoss = block('if (clock?.turn === human && liveRemaining(human) <= 0) {', 'return;');
  for (const [who, src] of [['bot', botLoss], ['human', humanLoss]]) {
    assert.match(src, new RegExp(`zeroFlaggedClock\\(${who}\\)`), `${who}'s clock is pinned`);
    assert.ok(src.indexOf(`zeroFlaggedClock(${who})`) < src.indexOf('setClockOver'),
      'and pinned before the result is announced, so card and board agree');
  }
});

test('FIDE 6.9 is the same rule on both sides of the net', () => {
  const inPage = blockIn(page, 'function sideHasMatingMaterial(g, color) {', 'const ONLINE_REASON_LABELS');
  const onServer = blockIn(backend, 'function sideHasMatingMaterial(g, color) {',
    '// Either participant resigns');
  assert.ok(inPage.includes('bishops') && onServer.includes('bishops'),
    'both halves count minor pieces rather than trusting a material score');

  /* They are written differently — the page returns from the loop, the server
     tallies first — so the only honest check is the same board through both. A
     player who flags against a bare king must be handed a draw in an online match
     AND in a bot game, because it is the same rule of chess. */
  const pageRule = evalRule(inPage);
  const serverRule = evalRule(onServer);
  const board = (rest, last) => new Chess(`4k3/8/8/8/8/8/${rest}/${last} w - - 0 1`);
  const cases = [
    ['a bare king', board('8', '4K3'), 'white', false],
    ['a lone bishop', board('1B6', '4K3'), 'white', false],
    ['a lone knight', board('1N6', '4K3'), 'white', false],
    ['two knights', board('1N1N4', '4K3'), 'white', false],
    ['three knights', board('NN2N3', '4K3'), 'white', true],
    ['two bishops', board('1B1B4', '4K3'), 'white', true],
    ['bishop and knight', board('1B1N4', '4K3'), 'white', true],
    ['a pawn', board('P7', '4K3'), 'white', true],
    ['a rook', board('R7', '4K3'), 'white', true],
    ['a queen', board('7Q', '4K3'), 'white', true],
    ['a bare black king', board('8', '4K3'), 'black', false],
    ['a black pawn', board('p7', '4K3'), 'black', true],
  ];
  for (const [name, g, color, expected] of cases) {
    assert.equal(pageRule(g, color), expected, `the page: ${name}`);
    assert.equal(serverRule(g, color), expected, `the server: ${name}`);
  }

  /* The bot branch asks the question, then overrides its own answer. */
  const draw = block('function drawOnFlag(winnerColor) {', '/* computer flag-fall */');
  assert.match(draw, /if \(sideHasMatingMaterial\(rebuildGame\(initialFen, moves\), winnerColor\)\) return \{\}/,
    'a win stands unless the position says otherwise');
  assert.match(draw, /draw: true/);
  assert.match(botFlag, /\.\.\.drawOnFlag\(human\)/);
  assert.match(botFlag, /\.\.\.drawOnFlag\(bot\)/, 'and it rules for the bot winning on time too');
});

/* ── 3. the card ─────────────────────────────────────────────────────────── */
test('the card names a timeout from the inside, for each player separately', () => {
  const onlineTimeout = block("if (why === 'Timeout') {", 'winner: r, mySide: myColor, wantsReview: true,');
  assert.match(onlineTimeout, /const wonOnTime = r === myColor;/,
    'the server decided the result; the page only asks whether it is mine');
  assert.match(onlineTimeout, /title: wonOnTime \? 'You Won!' : 'You Lost'/);
  assert.match(onlineTimeout, /reason: wonOnTime \? 'Opponent ran out of time' : 'You ran out of time'/,
    'the words say what happened to the reader, not the machine token');
  assert.match(onlineTimeout, /tone: wonOnTime \? 'win' : 'loss'/, 'green for a win, red for a loss');
  assert.match(onlineTimeout, /reason: 'Timeout vs insufficient material'/,
    'a flag against bare material is the draw the server stored, not a loss');
  assert.match(onlineTimeout, /mySide: myColor/, 'and the card still knows which side the reader played');

  /* The same words come out of a bot clock, so neither mode reads differently. */
  const clockBranch = block('if (clockOver && clockOver.title) {', 'if (status.over && moves.length > 0)');
  assert.match(clockBranch, /reason: won \? 'Opponent ran out of time' : 'You ran out of time'/);
  /* And the override is read FIRST: a null winner compared with myColor would
     otherwise come out as a loss for both players. */
  assert.ok(clockBranch.indexOf('if (clockOver.draw)') < clockBranch.indexOf('const won ='),
    'the draw is ruled before the win/loss test');
});

test('a timeout stays a timeout for the saved game and the reviewer', () => {
  /* The reason the server stores is what the card, the strip and Game Review all
     read — so a clock that fell can never be filed as a resignation again. */
  assert.match(line(backend, "const reason = 'timeout';"), /'timeout'/,
    'one token for a win AND for the FIDE 6.9 draw: the clock is what ended it');
  assert.match(backend, /const result = opponentCanMate \? winnerColor : 'draw';/,
    'the draw rides on the result, which keeps the two cases distinguishable');
  assert.match(line(page, "timeout: 'Timeout',"), /Timeout/, 'the label map still reads it');
  assert.ok(!/timeout_vs_insufficient/.test(page + backend),
    'and no second reason token was invented for it');
});

/* ── 4. the board after the flag ─────────────────────────────────────────── */
test('nothing is playable in a game that already has a result', () => {
  assert.match(boardLock, /const gameOver = onlineFinished \|\| Boolean\(clockOver\) \|\| \(status\.over && moves\.length > 0\);/,
    'each mode ends its own way and all of them lock');
  assert.match(boardLock, /const boardInteractive = reviewMode \? false/, 'review never plays moves');
  assert.match(boardLock, /gameOver \? false/);
  assert.match(boardLock, /const boardLive = boardInteractive && !waitingForOpponent;/,
    'the same flag feeds the board mount, so pieces cannot be dragged under a finished game');
  /* "Waiting for opponent…" over a dead board was the symptom the user reported. */
  const waiting = block('const waitingForOpponent = Boolean(onlineGame)',
    '(inOnline && onlineTurn !== onlineMyColor && moves.length === 0)');
  assert.match(waiting, /!onlineFinished/, 'a finished match is never described as waiting');
});

test('the fallen clock stays red after the game stops', () => {
  const derivation = block('const stored = clock ? (color', 'flagged={flagged}');
  assert.match(derivation, /const flagged = !!clock && !running && stored != null && stored <= 0;/,
    'red means STOPPED at zero, so a running clock can never flash it early');
  assert.match(line(page, "${flagged ? ' ab-clock-flagged' : ''}"), /ab-clock-flagged/);

  /* Same palette as the low-time warning — one state carried on from the other —
     on the page clock and the portalled Play Mode copy alike. */
  const rule = css.slice(css.indexOf('.ab-root.ab-root .ab-clock.ab-clock-flagged'),
    css.indexOf('/* static — no game running'));
  assert.ok(css.indexOf('.ab-root.ab-root .ab-clock.ab-clock-flagged') > -1, 'the rule must exist');
  assert.match(rule, /\.ab-clock\.ab-clock-flagged,\s*\.play-mode-overlay \.ab-clock\.ab-clock-flagged \{[^}]*background: #FEF2F2[^}]*border-color: #DC2626[^}]*\}/,
    'both clock surfaces, same light red as the warning');
  assert.match(rule, /\.ab-clock\.ab-clock-flagged \.ab-clock-time,\s*\.play-mode-overlay \.ab-clock\.ab-clock-flagged \.ab-clock-time \{ color: #DC2626; \}/,
    'and red numerals, on both surfaces too');
  /* A finished game goes quiet: no beat, no tick. */
  assert.doesNotMatch(rule, /animation|@keyframes/);
});

test('the move list closes with the score and how it ended', () => {
  assert.match(resultToken, /const endWord = onlineFinished/, 'the word comes from the stored reason');
  assert.match(resultToken, /onlineReasonLabel\(onlineGame\.resultReason\)/,
    'not from the card prose, so strip and card cannot disagree');
  assert.match(resultToken, /\(clockOver && clockOver\.title\) \? 'Timeout'/,
    'a bot clock has no server row to ask, so the fallen clock names itself');
  assert.match(resultToken, /=== 'aborted' \? null/, 'a match never played has no score to post');
  assert.match(resultToken, /'1-0'/);
  assert.match(resultToken, /'0-1'/);
  assert.match(resultToken, /'½-½'/);
  assert.equal((page.match(/resultToken=\{moveResultToken\}/g) || []).length, 2,
    'the strip is given it on the page and inside Play Mode');
  assert.equal((page.match(/\{resultToken && <span className="ab-mv-result">\{resultToken\}<\/span>\}/g) || []).length, 2,
    'rendered in the zero-move branch too — a flag on move 1 is still a result');
  assert.match(css, /\.ab-root\.ab-root \.ab-mv-result \{[^}]*white-space: nowrap/,
    'a long label can never stretch the strip or push the board');
  assert.match(css, /\.play-mode-overlay\[data-play-mode\] \.ab-mv-result \{/);
});

test('a finished match reloaded shows the result, not a fresh popup', () => {
  /* The card opens once per end state; a finished match fetched after a refresh
     is history, so the board carries the result without re-announcing it. */
  assert.match(line(page, 'if (onlineFinished && onlineSeenActiveRef.current !== onlineGame?.id) return;'),
    /return;/);
  assert.match(page, /if \(!finalResult\) \{ return; \}/, 'and an unfinished game has no card at all');
});

test('a clock cannot read negative, in either half', () => {
  /* Both readers of the same clock — the one the online watch and clock boxes
     use, and the one the bot loop uses — clamp at zero, so a tab that slept
     through its own flag shows 0:00 and never minus time. */
  const clamp = 'Math.max(0, stored - Math.max(0, Date.now() - (clock.serverNow || Date.now())))';
  assert.ok(block('function remainingMs(clock, running, color) {', 'const LOW_TIME_MS = 60000;').includes(clamp),
    'the shared reader clamps');
  assert.ok(block('function liveRemaining(color) {', 'const inOnline = onlineGame && onlineGame.status').includes(clamp),
    'and so does the bot-mode one, from the same expression');
  assert.match(backend, /whiteMs = Math\.max\(0, whiteMs - elapsed\);/,
    'the server clamps the same way, so a stale tab can never claim a minus clock');
});
