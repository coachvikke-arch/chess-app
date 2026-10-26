import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coachListFrom, coachNamesFrom } from '../src/utils/coachNames.js';

/* This file exists because a source-text test happily passed while the Profile
 * page crashed at runtime: coach_names is an array of { id, name } objects, and
 * the page rendered it as if it held strings. These tests use the real payload
 * shapes from authController's /auth/me query instead of matching source text. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = readFileSync(path.join(ROOT, 'src/pages/Profile.jsx'), 'utf8');

/* Verbatim from the live user: primary Shanmugaa plus an assigned second coach. */
const MULTI_COACH = {
  coach_name: 'Shanmugaa',
  coach_names: [{ id: 43, name: 'Shanmugaa' }, { id: 44, name: 'CoachVikke' }],
};

test('coach_names entries are unwrapped to plain names, never rendered as objects', () => {
  const names = coachNamesFrom(MULTI_COACH);
  assert.deepEqual(names, ['Shanmugaa', 'CoachVikke']);
  /* Every entry must be a string: this is exactly what React refused to render. */
  for (const n of names) assert.equal(typeof n, 'string');
});

test('the order the API returns is preserved, primary first', () => {
  assert.equal(coachListFrom(MULTI_COACH)[0].name, 'Shanmugaa');
});

test('a single assigned coach still renders', () => {
  assert.deepEqual(coachNamesFrom({ coach_name: 'Shanmugaa', coach_names: [{ id: 43, name: 'Shanmugaa' }] }), ['Shanmugaa']);
});

test('a student with no coach_names falls back to the group coach string', () => {
  /* coach_name is a bare string here, so this is the path that used to be mixed
     with the object shape. */
  assert.deepEqual(coachNamesFrom({ coach_name: 'Batch Coach', coach_names: [] }), ['Batch Coach']);
  assert.deepEqual(coachNamesFrom({ coach_name: 'Batch Coach' }), ['Batch Coach']);
});

test('a student with no coach at all yields an empty list, not a crash', () => {
  for (const user of [{}, { coach_name: null, coach_names: [] }, { coach_names: null }, null, undefined]) {
    assert.deepEqual(coachListFrom(user), []);
  }
});

test('a doubly-listed coach appears once', () => {
  const dupes = { coach_names: [{ id: 43, name: 'Shanmugaa' }, { id: 43, name: 'Shanmugaa' }] };
  assert.deepEqual(coachNamesFrom(dupes), ['Shanmugaa']);
});

test('two coaches sharing a display name stay distinct', () => {
  /* Keyed by name this would collapse to one entry and hide a real coach. */
  const twins = { coach_names: [{ id: 43, name: 'Coach Rao' }, { id: 44, name: 'Coach Rao' }] };
  assert.equal(coachListFrom(twins).length, 2);
});

test('a missing name is dropped instead of rendering a blank row', () => {
  const gappy = { coach_names: [{ id: 43, name: 'Shanmugaa' }, { id: null, name: null }, { id: 45 }] };
  assert.deepEqual(coachNamesFrom(gappy), ['Shanmugaa']);
});

test('a bare string entry is tolerated rather than crashing the page', () => {
  assert.deepEqual(coachNamesFrom({ coach_names: ['Shanmugaa', 'CoachVikke'] }), ['Shanmugaa', 'CoachVikke']);
});

test('the page renders names and keys rows by a stable identity', () => {
  assert.match(profile, /coachListFrom\(user\)/);
  assert.match(profile, /<li key=\{c\.id \?\? c\.name\}>\{c\.name\}<\/li>/);
  /* Guards the exact regression: rendering the raw object. */
  assert.doesNotMatch(profile, /<li key=\{c\}>\{c\}<\/li>/);
  assert.doesNotMatch(profile, /\{coachNames\.map\(\(c\) => c\)\}/);
});

test('the row label follows the number of coaches', () => {
  assert.match(profile, /coaches\.length > 1 \? 'Coaches' : 'Coach'/);
});