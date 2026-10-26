// One 12-hour clock for the whole app (src/utils/time.js).
//   run with: node --test scripts/time-format.test.mjs   (from frontend/)
//
// Times arrive as bare "HH:MM" strings from TIME columns or as Dates/ISO
// strings, and browsers disagree on toLocaleTimeString's default - so every
// time-of-day renders through formatTime12. Countdowns and durations are NOT
// times of day and must never use it (asserted by absence: nothing here imports
// a timer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime12, formatDateTime12 } from '../src/utils/time.js';

test('bare 24h strings become 12h AM/PM', () => {
  assert.equal(formatTime12('14:30'), '02:30 PM');
  assert.equal(formatTime12('02:31'), '02:31 AM');
  assert.equal(formatTime12('9:05'), '09:05 AM');
  assert.equal(formatTime12('12:00'), '12:00 PM');
  assert.equal(formatTime12('00:05'), '12:05 AM');
  assert.equal(formatTime12('23:59'), '11:59 PM');
  assert.equal(formatTime12('14:30:00'), '02:30 PM');
});

test('Dates and ISO strings use the same clock', () => {
  assert.equal(formatTime12(new Date(2026, 9, 7, 14, 31)), '02:31 PM');
  assert.equal(formatTime12('2026-10-07T09:05:00'), '09:05 AM');
});

test('garbage degrades to the fallback, never a wrong time', () => {
  assert.equal(formatTime12(''), '');
  assert.equal(formatTime12(null), '');
  assert.equal(formatTime12('blah', 'blah'), 'blah');
  assert.equal(formatTime12('25:00', 'x'), 'x');
});

test('datetimes render Indian-style date plus 12h time', () => {
  assert.equal(formatDateTime12('2026-10-07T14:31:00'), '07 Oct 2026, 02:31 PM');
  assert.equal(formatDateTime12('xx', '—'), '—');
});
