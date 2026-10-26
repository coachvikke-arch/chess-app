/* Remembered "Ask quiz" defaults.
 *
 * Run: node --test scripts/quiz-settings.test.mjs
 *
 * The config module is per-user and device-local (localStorage), so the tests
 * stub a tiny localStorage and drive the module through it — no DOM needed.
 * Covers the pure sanitiser/mappers, the round trip, blank-stays-blank, the
 * corrupted-data fallback, per-user isolation, and the modal wiring.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Minimal in-memory localStorage so the module can run under Node. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const {
  DEFAULT_QUIZ_SETTINGS,
  sanitizeQuizSettings,
  getQuizSettings,
  setQuizSettings,
  settingsToFields,
  fieldsToSettings,
} = await import('../src/config/quizSettings.js');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/* Pretend a given user is signed in (the module reads localStorage 'user'). */
function setUser(id) {
  if (id == null) localStorage.removeItem('user');
  else localStorage.setItem('user', JSON.stringify({ id }));
}

beforeEach(() => localStorage.clear());

/* ------------------------------------------------------------------ *
 * Sanitiser
 * ------------------------------------------------------------------ */

test('sanitize keeps non-negative finite numbers and rejects negatives', () => {
  const clean = sanitizeQuizSettings({
    timeLimitSec: 30,
    pointsOnSolve: 10,
    attemptsAllowed: null,
    pointsPerFail: -5,
  });
  assert.equal(clean.timeLimitSec, 30);
  assert.equal(clean.pointsOnSolve, 10);
  assert.equal(clean.attemptsAllowed, null, 'null is preserved');
  assert.equal(clean.pointsPerFail, null, 'negative is rejected');
});

test('sanitize rejects strings, NaN, Infinity and junk shapes', () => {
  assert.deepEqual(sanitizeQuizSettings(null), DEFAULT_QUIZ_SETTINGS);
  assert.deepEqual(sanitizeQuizSettings('nope'), DEFAULT_QUIZ_SETTINGS);
  assert.deepEqual(sanitizeQuizSettings([1, 2]), DEFAULT_QUIZ_SETTINGS);
  const clean = sanitizeQuizSettings({
    pointsOnSolve: '10',
    timeLimitSec: NaN,
    attemptsAllowed: Infinity,
    pointsPerFail: 0,
  });
  assert.equal(clean.pointsOnSolve, null, 'numbers only — a numeric string is not accepted');
  assert.equal(clean.timeLimitSec, null);
  assert.equal(clean.attemptsAllowed, null);
  assert.equal(clean.pointsPerFail, 0, 'a real zero is a valid value');
});

/* ------------------------------------------------------------------ *
 * Round trip / prefill
 * ------------------------------------------------------------------ */

test('values saved on Start are loaded back on the next open', () => {
  setUser(7);
  setQuizSettings({ timeLimitSec: 45, pointsOnSolve: 12, attemptsAllowed: 3, pointsPerFail: 2 });
  assert.deepEqual(getQuizSettings(), {
    timeLimitSec: 45,
    pointsOnSolve: 12,
    attemptsAllowed: 3,
    pointsPerFail: 2,
  });
  assert.deepEqual(settingsToFields(getQuizSettings()), {
    timeLimitSeconds: '45',
    points: '12',
    maxAttempts: '3',
    negativePoints: '2',
  });
});

test('blank fields stay blank through the round trip (never 0)', () => {
  setUser(7);
  setQuizSettings(fieldsToSettings({
    timeLimitSeconds: '',
    points: '10',
    maxAttempts: '',
    negativePoints: '',
  }));
  const loaded = getQuizSettings();
  assert.equal(loaded.timeLimitSec, null);
  assert.equal(loaded.attemptsAllowed, null);
  assert.equal(loaded.pointsPerFail, null);
  assert.equal(loaded.pointsOnSolve, 10);
  assert.deepEqual(settingsToFields(loaded), {
    timeLimitSeconds: '',
    points: '10',
    maxAttempts: '',
    negativePoints: '',
  });
});

/* ------------------------------------------------------------------ *
 * Corruption & isolation
 * ------------------------------------------------------------------ */

test('corrupted or missing data falls back to empty fields', () => {
  setUser(7);
  localStorage.setItem('knightpath-quiz-settings:7', '{not json');
  assert.deepEqual(getQuizSettings(), DEFAULT_QUIZ_SETTINGS);
  localStorage.removeItem('knightpath-quiz-settings:7');
  assert.deepEqual(getQuizSettings(), DEFAULT_QUIZ_SETTINGS);
});

test('saved values never leak between users', () => {
  setUser(1);
  setQuizSettings({ timeLimitSec: 30, pointsOnSolve: 5, attemptsAllowed: 2, pointsPerFail: 1 });
  setUser(2);
  assert.deepEqual(getQuizSettings(), DEFAULT_QUIZ_SETTINGS, 'a different instructor sees nothing');
  setUser(1);
  assert.equal(getQuizSettings().pointsOnSolve, 5, 'the original instructor keeps theirs');
});

/* ------------------------------------------------------------------ *
 * The modal is wired to it
 * ------------------------------------------------------------------ */

test('the dialog pre-fills on open, saves on Start, and can reset', () => {
  const modal = read('src', 'components', 'liveclass', 'QuizAskModal.jsx');
  assert.match(modal, /useState\(\(\) => settingsToFields\(getQuizSettings\(\)\)\)/, 'pre-fills on open');
  assert.match(modal, /setQuizSettings\(fieldsToSettings\(fields\)\)/, 'saves the fields');
  assert.match(modal, /Reset to defaults/, 'has the reset link');
  assert.match(modal, /settingsToFields\(DEFAULT_QUIZ_SETTINGS\)/, 'reset clears to the blank defaults');

  const saveAt = modal.indexOf('setQuizSettings(fieldsToSettings(fields))');
  const startAt = modal.indexOf('const start =');
  const nextFn = modal.indexOf('const set =');
  assert.ok(saveAt > startAt && saveAt < nextFn, 'the save happens inside start(), not on open/cancel');
});
