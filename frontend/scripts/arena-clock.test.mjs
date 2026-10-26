// Regression tests for the Play Arena clock after a game ends -
  //   run with: node --test scripts/arena-clock.test.mjs   (from frontend/)
  //
  // Reported symptom: after a bot game ended by checkmate, both clocks were
  // still counting down with the result popup already showing.
  //
  // Cause: `liveRemaining()` only freezes while `clockRunning` is false, and
  // EVERY computer-game finish path bailed out early on `isGameOver()` without
  // ever clearing it - so the side that had just moved ticked down forever.
  //
  // Three related defects are guarded here too:
  //  1. The bot had no flag-fall at all, so a bot that ran its clock out left
  //     the game unfinishable at 00:00.
  //  2. `selfColorCode` inverted the bot's colour, so playing White against the
  //     bot played the opponent cue for every move.
  //  3. `clockOver.winner` was stored as the LOSER, and the overlay compared it
  //     to 'White' while the producer wrote lowercase - so a white win on time
  //     rendered the black king. Consumers now read a real winner + humanWon.
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { dirname, join } from 'node:path';

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(ROOT, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');

  /* liveRemaining is the only thing that makes a clock appear stopped. */
  const liveRemaining = src.slice(
    src.indexOf('function liveRemaining'),
    src.indexOf('function liveRemaining') + 600,
  );

  test('liveRemaining freezes only while clockRunning is false', () => {
    assert.match(liveRemaining, /if \(!clockRunning \|\| clock\.turn !== color\) return stored;/,
      'the frozen value is returned when the clock is not running');
    assert.match(liveRemaining, /Math\.max\(0, stored - Math\.max\(0, Date\.now\(\)/,
      'otherwise the stored time decays against the wall clock');
  });

  test('the clock is stopped the moment the game is over', () => {
    /* The status.over effect is the one place every finish route passes
       through - checkmate, stalemate, repetition and insufficient material all
       arrive as getStatus().over. */
    const i = src.indexOf('}, [status.over]);');
    assert.notEqual(i, -1, 'the status.over effect must exist');
    const effect = src.slice(src.lastIndexOf('useEffect(', i), i);
    assert.match(effect, /if \(!status\.over\) return;/,
      'the effect must gate on status.over');
    assert.match(effect, /setClockRunning\(false\);/,
      'game over must stop the clock - this is the reported bug');
  });

  test('the status.over effect can never restart a clock', () => {
    /* undoing a move recomputes status from an earlier position (status.over
       goes false again). If this effect could set the clock running, a finished
       game would silently resume. It must only ever set false. */
    const i = src.indexOf('}, [status.over]);');
    const effect = src.slice(src.lastIndexOf('useEffect(', i), i);
    const sets = effect.match(/setClockRunning\([^)]*\)/g) || [];
    assert.ok(sets.length > 0, 'expected at least one setClockRunning call');
    for (const call of sets) {
      assert.equal(call, 'setClockRunning(false)',
        `game-over effect must only stop the clock, found: ${call}`);
    }
  });

  test('both sides can flag: the human AND the bot', () => {
    const i = src.indexOf('/* computer flag-fall */');
    assert.notEqual(i, -1, 'the flag-fall effect must exist');
    const effect = src.slice(i, src.indexOf('}, [computerOn, clockRunning, computerColor', i));
    assert.match(effect, /const bot = human === 'white' \? 'black' : 'white';/,
      'the bot colour must be derived from the human colour');
    assert.match(effect, /clock\?\.turn === bot && liveRemaining\(bot\) <= 0/,
      'the bot running out of time must end the game');
    assert.match(effect, /clock\?\.turn === human && liveRemaining\(human\) <= 0/,
      'the human running out of time must end the game');
    assert.match(effect, /humanWon: true,\s*title: 'You won on time'/,
      'a bot flag is a win for the human');
    assert.match(effect, /humanWon: false,\s*title: 'You lost on time'/,
      'a human flag is a loss');
    /* both branches must actually stop the clock */
    const stops = effect.match(/setClockRunning\(false\);/g) || [];
    assert.ok(stops.length >= 2, 'both flag branches must stop the clock');
  });

  test('selfColorCode is the human side, not the inverted one', () => {
    const i = src.indexOf('const selfColorCode');
    assert.notEqual(i, -1, 'selfColorCode must exist');
    const block = src.slice(i, src.indexOf(';', i + 400));
    assert.match(block, /\? \(computerColor === 'white' \? 'w' : 'b'\)/,
      'computerColor already holds the colour the HUMAN plays (startComputerGame ' +
      'sets setComputerColor(playAs) with setOrientation(playAs)), so it must not be inverted');
  });

  test('clockOver.winner means the winner, and every consumer agrees', () => {
    /* overlay glyph: the producer writes lowercase colours */
    const overlay = src.slice(src.indexOf("mode: 'clock'") - 320, src.indexOf("mode: 'clock'"));
    assert.match(overlay, /clockOver\.winner === 'white' \?/,
      'the glyph must compare against lowercase "white"; "White" never matches and ' +
      'always drew the black king');
    assert.match(overlay, /winner: clockOver\.winner/,
      'the overlay reports the real winner');

    /* buildResult reads the explicit flag */
    assert.match(src, /const won = clockOver\.humanWon \?\? clockOver\.winner === myColor;/,
      'a win/loss must come from humanWon, not from inverting the winner');
    assert.ok(!/const won = clockOver\.winner !== myColor;/.test(src),
      'inverting the winner was only correct while the field secretly held the loser');

    /* the spectator record must not invert a real winner */
    assert.match(src, /result: clockOver\s*\n\s*\? clockOver\.winner/,
      'pushSpec records the winner colour directly');
    assert.ok(!/clockOver\.winner\?\.toLowerCase\(\) === 'white' \? 'black' : 'white'/.test(src),
      'that inversion would broadcast every flagged game with the result flipped');
  });

  test('a computer game is never rated, so no rating delta is shown', () => {
    /* Guards the misreading behind the report: the "+10 / -10" beside the
       captured pieces is the MATERIAL balance (CapturedTray diff), and the
       "Lv6 Club Player - 950-1100" string is a static per-level band from
       skillLabel(). Neither is an ELO change. Only onlineController (student vs
       student) and tournamentController ever call rating.applyGameResult. */
    assert.match(src, /<CapturedTray[\s\S]{0,200}diff=/,
      'the +10/-10 next to the pieces is the captured-material diff');
    assert.match(src, /function skillLabel[\s\S]{0,240}ratingMin \+ '-' \+ lvl\.ratingMax/,
      'the 950-1100 label is a static skill band, not a rating');
    assert.ok(!/rating_change|ratingChange|eloDelta/.test(src),
      'the Play Arena must not fabricate a rating change - bot games are unrated');
  });