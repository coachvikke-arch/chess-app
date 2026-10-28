// Regression tests for the Play Arena time-control picker.
//   run with: node --test scripts/time-control-picker.test.mjs   (from frontend/)
//
// Reported problems:
//  1. The online card still offered "Casual" next to "Rated".
//  2. The time control was three <select>s plus category chips, and the labels
//     could read as one run-on string ("1+03+03+210+015+1030+0").
//  3. Hours above 1 h were silently clamped to 60 minutes by the API.
//
// The picker renders one preset chip per clock and three dropdowns whose
// options are individual values, and the same numbers that are displayed are
// sent as baseMinutes/incrementSeconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  TIME_CONTROL_PRESETS,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  INCREMENT_OPTIONS,
  MAX_BASE_MINUTES,
  timeControlMinutes,
  isTimeControlValid,
  formatTimeControl,
  describeTimeControl,
  timeControlFamily,
} from '../src/utils/timeControl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const board = read('src', 'pages', 'AnalysisBoard.jsx');
const picker = read('src', 'components', 'TimeControlPicker.jsx');
const backend = readFileSync(join(ROOT, '..', 'backend', 'src', 'controllers', 'onlineController.js'), 'utf8');

test('the six presets are exactly the ones requested, one object each', () => {
  assert.deepEqual(TIME_CONTROL_PRESETS.map((p) => p.label), ['1+0', '3+0', '3+2', '10+0', '10+30', '30+0']);
  for (const p of TIME_CONTROL_PRESETS) {
    assert.equal(typeof p.hours, 'number');
    assert.equal(typeof p.base, 'number');
    assert.equal(typeof p.inc, 'number');
  }
});

test('custom values are separate numbers, never one concatenated label', () => {
  assert.deepEqual(HOUR_OPTIONS, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(MINUTE_OPTIONS, [0, 1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60]);
  assert.deepEqual(INCREMENT_OPTIONS, [0, 1, 2, 3, 5, 10, 15, 20, 30]);
});

test('the readout stays readable for hours, minutes and increment', () => {
  assert.equal(formatTimeControl({ hours: 0, base: 10, inc: 0 }), '10+0');
  assert.equal(formatTimeControl({ hours: 0, base: 3, inc: 2 }), '3+2');
  assert.equal(formatTimeControl({ hours: 1, base: 30, inc: 5 }), '1:30:00 + 5s');
  assert.equal(formatTimeControl({ hours: 5, base: 0, inc: 0 }), '5:00:00 + 0s');
  assert.match(describeTimeControl({ hours: 1, base: 30, inc: 5 }), /1 h 30 min starting clock · 5 s per move/);
  assert.equal(formatTimeControl({ hours: 0, base: 0, inc: 0 }), '0+0');
});

test('the clock family uses base + 40 increments', () => {
  assert.equal(timeControlFamily({ hours: 0, base: 1, inc: 0 }), 'Bullet');
  assert.equal(timeControlFamily({ hours: 0, base: 3, inc: 2 }), 'Blitz');
  assert.equal(timeControlFamily({ hours: 0, base: 10, inc: 0 }), 'Rapid');
  assert.equal(timeControlFamily({ hours: 0, base: 30, inc: 0 }), 'Classical');
});

test('a zero clock is invalid, anything from 1 minute works', () => {
  assert.equal(isTimeControlValid({ hours: 0, base: 0, inc: 30 }), false);
  assert.equal(isTimeControlValid({ hours: 0, base: 1, inc: 0 }), true);
  assert.equal(timeControlMinutes({ hours: 2, base: 30 }), 150);
});

test('the picker uses three real dropdowns, one option per value', () => {
  assert.equal((picker.match(/<select/g) || []).length, 3, 'hours, minutes and increment are three selects');
  assert.match(picker, /HOUR_OPTIONS\.map/, 'hours come from the shared option list');
  assert.match(picker, /MINUTE_OPTIONS\.map/, 'minutes come from the shared option list');
  assert.match(picker, /INCREMENT_OPTIONS\.map/, 'increment comes from the shared option list');
  assert.match(picker, /TIME_CONTROL_PRESETS\.map/, 'the preset chips are kept');
  assert.match(picker, /<option key=\{h\} value=\{h\}>/, 'each hour is its own selectable option');
  assert.match(picker, /<option key=\{m\} value=\{m\}>/, 'each minute is its own selectable option');
  assert.match(picker, /<option key=\{s\} value=\{s\}>/, 'each increment is its own selectable option');
  assert.ok(!/tc-options|tc-block/.test(picker), 'the old chip groups are gone');
  assert.ok(!/value=\{[^}]*\}\+\{/.test(picker), 'no string-built option values');
});

test('online and Computer Play offer the same clock options', () => {
  const start = board.indexOf('aria-label="Hours"');
  const computerPanel = board.slice(start, board.indexOf('<div className="space-y-0.5">', start));
  assert.ok(start > -1, 'Computer Play still has its own Hours select');
  assert.match(computerPanel, /\[0, ?1, ?2, ?3, ?4, ?5\]/, 'same hour list');
  assert.match(computerPanel, /\[0, ?1, ?2, ?3, ?4, ?5, ?10, ?15, ?20, ?30, ?45, ?60\]/, 'same minute list');
  assert.match(computerPanel, /\[0, ?1, ?2, ?3, ?5, ?10, ?15, ?20, ?30\]/, 'same increment list');
});

test('the online card has the picker and no Casual button', () => {
  assert.match(board, /<TimeControlPicker[\s\S]{0,160}value=\{timeSel\}/,
    'the online popup must use the shared picker');
  assert.ok(!/Casual/.test(board), 'the Casual option was removed');
  assert.ok(!/ONLINE_TC_CATEGORIES|onlineTcCategory|onlineRated/.test(board),
    'the old category chips and dead rated state are gone');
});

test('the displayed clock is the one sent to the API', () => {
  assert.match(board, /baseMinutes: timeSel\.hours \* 60 \+ timeSel\.base, incrementSeconds: timeSel\.inc/,
    'createGame receives the picked minutes and increment');
  assert.match(board, /whiteMs: \(timeSel\.hours \* 60 \+ timeSel\.base\) \* 60000/,
    'the local clock starts at the same base time');
  assert.match(board, /incMs:\s+timeSel\.inc \* 1000/,
    'the local clock keeps the picked increment');
});

test('a zero starting clock cannot create a match', () => {
  assert.match(board, /disabled=\{onlineBusy \|\| !isTimeControlValid\(timeSel\)\}/,
    'the create button is disabled while the clock is 0h + 0m');
  assert.match(board, /Pick at least 1 minute for the starting clock/,
    'the modal explains why the button is disabled');
});

test('0h + 10m + 5s is a 10+5 match', () => {
  assert.equal(timeControlMinutes({ hours: 0, base: 10 }), 10);
  assert.equal(formatTimeControl({ hours: 0, base: 10, inc: 5 }), '10+5');
});

test('every dropdown option produces a numeric clock and increment', () => {
  for (const h of HOUR_OPTIONS) {
    for (const m of MINUTE_OPTIONS) {
      assert.equal(timeControlMinutes({ hours: h, base: m }), h * 60 + m,
        `${h}h ${m}m must be ${h * 60 + m} minutes`);
      assert.equal(isTimeControlValid({ hours: h, base: m }), h * 60 + m >= 1,
        `${h}h ${m}m validity`);
    }
  }
  for (const s of INCREMENT_OPTIONS) {
    assert.equal(formatTimeControl({ hours: 0, base: 10, inc: s }), `10+${s}`);
  }
});

test('both players get the same clock and the same increment', () => {
  const create = backend.slice(backend.indexOf('exports.createGame'), backend.indexOf('exports.createClassroomGames'));
  assert.match(create, /const startMs = baseMin \* 60000/, 'initial clock comes from the picked base');
  assert.match(create, /white_ms, black_ms/, 'both sides store a clock');
  assert.match(create, /\$7, \$7\)/, 'both sides start from the same startMs');

  const move = backend.slice(backend.indexOf('exports.moveGame'), backend.indexOf('exports.endGame'));
  assert.match(move, /const incMs = \(Number\(row\.time_increment_seconds\) \|\| 0\) \* 1000/,
    'the mover gets the stored increment');
  assert.match(move, /const moverMsAfter = moverMsBefore \+ incMs;/,
    'the increment is added after a valid move');
  assert.match(move, /if \(moverColor === 'white'\) whiteMs = moverMsAfter;\s*else blackMs = moverMsAfter;/,
    'either colour receives it on their own clock');
});

test('the API accepts the picker\'s full range of hours', () => {
  const clamp = backend.slice(backend.indexOf('const baseMin ='), backend.indexOf('const baseMin =') + 300);
  assert.match(clamp, /Math\.min\(360,/, 'base minutes are capped at 6 h, not the old 60 min');
  assert.ok(MAX_BASE_MINUTES <= 360, 'the UI never offers more than the API allows');
});
