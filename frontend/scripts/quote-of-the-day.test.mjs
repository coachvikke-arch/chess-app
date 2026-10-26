// Quote-of-the-day determinism tests.
//   run with: node --test scripts/quote-of-the-day.test.mjs   (from frontend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gmQuotes } from '../src/lib/gmQuotes.js';
import {
  QUOTE_EPOCH,
  dayNumberFromLocalDate,
  getQuoteIndex,
  msUntilNextLocalMidnight,
} from '../src/lib/quoteOfTheDay.js';

const N = gmQuotes.length;
const DAY_MS = 86_400_000;
// Local-midnight helper: the lib reads LOCAL calendar dates, so tests build
// dates with (y, m, d) constructor to avoid timezone drift entirely.
const localMidnight = (offsetDays = 0) =>
  new Date(QUOTE_EPOCH.year, QUOTE_EPOCH.month - 1, QUOTE_EPOCH.day + offsetDays);

test('quote list has exactly 365 unique entries with required shape', () => {
  assert.equal(N, 365);
  const ids = new Set();
  const english = new Set();
  for (const q of gmQuotes) {
    assert.ok(q.id && typeof q.id === 'string');
    assert.ok(q.en && typeof q.en === 'string');
    assert.ok(q.ta && typeof q.ta === 'string');
    assert.ok(q.author && typeof q.author === 'string');
    assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
    assert.ok(!english.has(q.en), `duplicate english: ${q.en}`);
    ids.add(q.id);
    english.add(q.en);
  }
});

test('365 consecutive days yield 365 different quotes, and day 366 equals day 1', () => {
  const seen = new Set();
  for (let i = 0; i < 365; i++) {
    seen.add(getQuoteIndex(N, localMidnight(i)));
  }
  assert.equal(seen.size, 365, 'expected a different quote for each of 365 days');
  const day1 = getQuoteIndex(N, localMidnight(0));
  const day366 = getQuoteIndex(N, localMidnight(365));
  assert.equal(day366, day1, 'day 366 must repeat day 1');
});

test('epoch start is day 0 and index 0', () => {
  assert.equal(dayNumberFromLocalDate(localMidnight(0)), 0);
  assert.equal(getQuoteIndex(N, localMidnight(0)), 0);
});

test('dayNumber advances by exactly one per local calendar day', () => {
  assert.equal(dayNumberFromLocalDate(localMidnight(1)), 1);
  assert.equal(dayNumberFromLocalDate(localMidnight(364)), 364);
  assert.equal(dayNumberFromLocalDate(localMidnight(365)), 365);
});

test('midnight rollover switches to the next quote', () => {
  const before = new Date(QUOTE_EPOCH.year, QUOTE_EPOCH.month - 1, QUOTE_EPOCH.day, 23, 59, 59, 999);
  const after = new Date(QUOTE_EPOCH.year, QUOTE_EPOCH.month - 1, QUOTE_EPOCH.day + 1, 0, 0, 0, 0);
  const iBefore = getQuoteIndex(N, before);
  const iAfter = getQuoteIndex(N, after);
  assert.notEqual(iAfter, iBefore, 'quote must change exactly at local midnight');
  assert.equal((iAfter - iBefore + N) % N, 1);
});

test('msUntilNextLocalMidnight is positive and lands on the next local midnight', () => {
  const now = new Date(QUOTE_EPOCH.year, QUOTE_EPOCH.month - 1, QUOTE_EPOCH.day, 23, 0, 0, 0);
  const ms = msUntilNextLocalMidnight(now);
  assert.ok(ms > 0 && ms <= DAY_MS);
  assert.equal(now.getTime() + ms, localMidnight(1).getTime());
});