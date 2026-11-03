import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The low-time clock warning in the Play Arena.
 *
 * One contract, stated twice by the user (once for the warning itself, once for
 * "all modes"): below a minute, the clock that is RUNNING turns red, beats about
 * once a second, and ticks — in every mode, from one place, and stopping on
 * every possible way a clock can stop.
 *
 * The failure this guards against is the one the second request named: a clock
 * rendered by hand, outside the shared component. The Play Mode bottom row used
 * to do exactly that with a raw `ClockBox` and its own `liveRemaining() < 10000`
 * comparison — a threshold no other clock used, on a copy of the board the old
 * code never repainted.
 */

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const board = read('src/pages/AnalysisBoard.jsx');
const sound = read('src/utils/sound.js');
const soundCtx = read('src/context/SoundContext.jsx');
const css = read('src/index.css');

/** The body of `declaration`, up to the line that closes it. */
function body(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} is missing`);
  const lines = source.slice(start).split('\n');
  let depth = 0;
  const out = [];
  for (const line of lines) {
    out.push(line);
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (out.length > 1 && depth === 0) break;
  }
  return out.join('\n');
}

const clock = body(board, 'function GameClock(');

/* ─── one shared clock, no bypasses ──────────────────────────────────────── */

test('every clock in the arena is the shared component', () => {
  assert.equal((board.match(/<GameClock\b/g) || []).length, 4,
    'expected four clock sites: page top, page bottom, Play Mode top, Play Mode bottom');
  assert.equal((board.match(/<ClockBox\b/g) || []).length, 1,
    'a raw ClockBox is being rendered again — it must only be used by GameClock');
  assert.ok(clock.includes('<ClockBox'), 'GameClock no longer renders the presentational box');
  assert.doesNotMatch(board, /liveRemaining\([^)]*\)\s*<(?!=)/,
    'a hand-computed low-time comparison is back outside remainingMs');
});

test('the warning is decided inside the component, not by each caller', () => {
  assert.match(board, /const LOW_TIME_MS = 60000;/);
  assert.match(clock, /const low = ticking && left > 0 && left < LOW_TIME_MS;/);
  assert.match(clock, /low=\{low\}/);
  /* No caller may pass its own verdict. */
  assert.equal((board.match(/low=\{/g) || []).length, 1, 'two components decide "low"');
  /* A game that starts under a minute needs no special case: the rule reads the
     remaining time, never the time control. */
  assert.doesNotMatch(clock, /timeSel|base|preset/i,
    'the warning must not depend on which time control was chosen');
});

test('it triggers only while that clock is running, and never at zero', () => {
  assert.match(clock, /const ticking = !!clock && running && clock\.turn === color;/);
  /* `low` is built from `ticking`, so a stopped clock — paused, game over, or
     the side that is not on move — cannot be low. */
  assert.ok(clock.indexOf('const ticking') < clock.indexOf('const low'),
    'low is not derived from the running check');
  assert.match(clock, /left > 0/, 'a flagged clock must not keep warning');
});

/* ─── the tick sound ─────────────────────────────────────────────────────── */

test('the tick is one per second, starts with the warning and stops with it', () => {
  const tickEffect = clock.slice(clock.indexOf("if (!low || silent || !soundOn) return undefined;"));
  assert.ok(tickEffect.length > 0, 'the tick effect has no stop condition');
  assert.match(tickEffect, /\n\s*playSound\('tick'\);/, 'no immediate first beat');
  assert.match(tickEffect, /setInterval\(\(\) => playSound\('tick'\), 1000\)/);
  assert.match(tickEffect, /return \(\) => clearInterval\(t\)/, 'the interval outlives the warning');
  assert.match(clock, /\}, \[low, silent, soundOn, playSound\]\);/);
});

test('the tick is a synthesized cue, and muting the app mutes it', () => {
  assert.match(sound, /case 'tick':/);
  assert.match(sound, /tick: 0\.26/);
  /* No tick.mp3 exists in public/sounds, so the cue is generated. */
  const cue = body(sound, "case 'tick':");
  assert.match(cue, /tone\(/);
  assert.doesNotMatch(cue, /playSample\('tick'\)/);
  assert.match(sound, /export function playSound\(kind\) \{\n  if \(!enabled\) return;/,
    'playSound no longer obeys the master switch — a muted app would still tick');
});

test('it reads the app-wide sound switch, not a page-local one', () => {
  assert.match(clock, /const \{ soundOn, playSound \} = useSound\(\);/);
  assert.match(soundCtx, /export function useSound\(\)/);
  assert.ok(board.includes("import { useSound } from '../context/SoundContext'"));
});

test('only one copy of a clock makes noise', () => {
  /* Play Mode portals a full-screen arena while .ab-layout stays mounted, so
     the same side is on screen twice. The hidden copy is silenced. */
  assert.match(clock, /function GameClock\(\{ clock, running, color, forceFloor, silent = false \}\)/);
  assert.equal((board.match(/silent=\{playMode\}/g) || []).length, 2,
    'expected exactly the two page clocks to be silenced under Play Mode');
  assert.doesNotMatch(board, /silent=\{!playMode\}/,
    'a Play Mode clock is silenced — that is the visible one');
});

/* ─── every stop condition ───────────────────────────────────────────────── */

test('stopping the clock stops the warning', () => {
  /* Each of these is a way a clock stops. All of them already put `running`
     down, and `low` is built from it — so nothing extra can leak. */
  const over = board.slice(board.indexOf('if (!status.over) return;'), board.indexOf('}, [status.over]'));
  assert.match(over, /setClockRunning\(false\)/, 'a finished game keeps ticking');
  assert.match(body(board, 'function clearOnline(clocks)'), /if \(clocks\) \{ setClock\(null\); setClockRunning\(false\); \}/);
  /* A new game goes through the same door as leaving the board. */
  assert.match(body(board, 'function fullReset()'), /clearOnline\(true\);/);
  assert.match(body(board, 'function exitComputer()'), /setClockRunning\(false\)/);
  /* Timeout: both flags in the engine path stop the clock. */
  const flagFall = board.slice(board.indexOf('/* computer flag-fall */'), board.indexOf('/* online flag-fall'));
  assert.equal((flagFall.match(/setClockRunning\(false\)/g) || []).length, 2);
  /* An online flag is reported to the server; the row that comes back is no
     longer active, and running is read straight off that row. */
  assert.match(body(board, 'function applyOnlineMeta(row)'), /setClockRunning\(row\.status === 'active'\)/);
});

test('a new game and a rematch leave no warning state behind', () => {
  /* There is deliberately nothing to clear: the warning is derived, so `clock`
     being nulled (reset / clearOnline) or replaced (a rematch row arriving)
     takes the red, the beat and the tick with it. */
  assert.doesNotMatch(board, /const \[(lowTime|clockWarn|warnClock|isLow|ticking)[A-Za-z]*, set/,
    'a separate piece of low-time state was added — that is what drifts');
  assert.match(body(board, 'async function resetPlayArena()'), /setClock\(null\); setClockRunning\(false\); setClockOver\(null\);/);
});

/* ─── the look ───────────────────────────────────────────────────────────── */

test('the warning is red text on a light red panel, in both clock subtrees', () => {
  const rule = /ab-clock\.ab-clock-low \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the shared low-time rule is gone from index.css');
  assert.match(rule[1], /background:\s*#FEF2F2/);
  assert.match(rule[1], /border-color:\s*#DC2626/);
  assert.match(rule[1], /animation:\s*ab-clock-beat 1s ease-in-out infinite/);
  /* The page clocks live under .ab-root; the Play Mode copy is portalled out of
     it. Both selectors must be in the same rule or one surface quietly loses
     the warning. */
  assert.match(css, /\.ab-root\.ab-root \.ab-clock\.ab-clock-low,\n\.play-mode-overlay \.ab-clock\.ab-clock-low \{/);
  assert.match(css, /\.ab-root\.ab-root \.ab-clock\.ab-clock-low \.ab-clock-time,\n\.play-mode-overlay \.ab-clock\.ab-clock-low \.ab-clock-time \{ color: #DC2626; \}/);
});

test('the old flashing clock style is gone', () => {
  assert.doesNotMatch(css, /\.ab-clock\.ab-clock-low[^{]*\{[^}]*clock-flash/,
    'two different animations are declared for the same warning');
  /* The keyframes stay — the dead .clock-box.low block above still names them —
     but nothing on a real board may use them. */
  assert.equal((css.match(/animation: clock-flash/g) || []).length, 1);
});

test('the beat never changes the clock size or layout', () => {
  const frames = /@keyframes ab-clock-beat \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(frames, 'the beat keyframes are missing');
  for (const prop of ['width', 'height', 'padding', 'margin', 'font-size', 'display', 'opacity']) {
    assert.ok(!frames[1].includes(`${prop}:`), `the beat animates ${prop} — that moves the row`);
  }
  assert.match(frames[1], /transform: scale\(/);
  assert.match(frames[1], /box-shadow:/);
  /* The base clock box is still exactly the size it was. */
  assert.match(board, /\.ab-root\.ab-root \.ab-clock\{\n  margin-left:auto;flex:none;padding:4px 10px;border-radius:8px;/);
  assert.match(board, /\.ab-root\.ab-root \.ab-clock-time\{font-size:14px;font-weight:700;color:#0F172A\}/);
  assert.match(css, /\.play-mode-player \.ab-clock-time \{ font-size: 1\.35rem; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.ab-root\.ab-root \.ab-clock\.ab-clock-low,\n  \.play-mode-overlay \.ab-clock\.ab-clock-low \{ animation: none; \}/);
});
