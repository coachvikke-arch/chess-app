import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEventType, normalizeFilter, useFilteredEvents,
  countByFilterType, countsForDate, FILTER_KEYS,
} from '../src/utils/eventFilter.js';

const ev = (over) => ({
  kind: 'class', type: 'class', id: Math.random(), title: 'x', date: '2026-10-12', time: '', ...over,
});

test('classifies by the explicit type field', () => {
  assert.equal(getEventType({ type: 'class' }), 'class');
  assert.equal(getEventType({ type: 'assignment' }), 'assignment');
  assert.equal(getEventType({ type: 'puzzle' }), 'puzzle');
});

test('falls back to kind when type is missing', () => {
  assert.equal(getEventType({ kind: 'class' }), 'class');
  // 'homework' is the app's internal kind name for an assignment.
  assert.equal(getEventType({ kind: 'homework' }), 'assignment');
  assert.equal(getEventType({ kind: 'puzzle' }), 'puzzle');
});

test('falls back to the emoji prefix', () => {
  assert.equal(getEventType({ type: '🏫 E2E' }), 'class');
  assert.equal(getEventType({ type: '📝 Algebra' }), 'assignment');
  assert.equal(getEventType({ type: '🧩 Mate in 2' }), 'puzzle');
});

test('falls back to a leading emoji in the title', () => {
  assert.equal(getEventType({ title: '🏫 Weekly class' }), 'class');
  assert.equal(getEventType({ title: '🧩 Endgame' }), 'puzzle');
});

test('an explicit type outranks a contradictory kind', () => {
  // A tournament whose internal kind is 'class' is still a tournament: it must
  // not leak into the Classes filter just because kind says otherwise.
  assert.equal(getEventType({ type: 'tournament', kind: 'class' }), null);
  assert.equal(getEventType({ type: 'puzzle', kind: 'homework' }), 'puzzle');
});

test('kinds outside the three buckets are unclassified', () => {
  assert.equal(getEventType({ kind: 'tournament', type: 'tournament' }), null);
  assert.equal(getEventType({ kind: 'file', type: 'file' }), null);
  assert.equal(getEventType(null), null);
  assert.equal(getEventType({}), null);
});

test('an emoji prefix beats a misleading keyword', () => {
  // "homework class" is an assignment, not a class — the emoji must win.
  assert.equal(getEventType({ title: '🏫 homework class' }), 'class');
});

test('normalizeFilter accepts known keys and rejects junk', () => {
  for (const key of FILTER_KEYS) assert.equal(normalizeFilter(key), key);
  // Plurals must work too — the documented share link is ?filter=classes.
  assert.equal(normalizeFilter('classes'), 'class');
  assert.equal(normalizeFilter('assignments'), 'assignment');
  assert.equal(normalizeFilter('puzzles'), 'puzzle');
  assert.equal(normalizeFilter('CLASSES'), 'class');
  assert.equal(normalizeFilter('nonsense'), 'all');
  assert.equal(normalizeFilter(null), 'all');
  assert.equal(normalizeFilter(undefined), 'all');
});

test('useFilteredEvents keeps only the chosen type', () => {
  const list = [ev({ type: 'class' }), ev({ type: 'assignment' }), ev({ type: 'puzzle' })];
  assert.equal(useFilteredEvents(list, 'all').length, 3);
  assert.equal(useFilteredEvents(list, 'class').length, 1);
  assert.equal(useFilteredEvents(list, 'class')[0].type, 'class');
  assert.equal(useFilteredEvents(list, 'assignment')[0].type, 'assignment');
  assert.equal(useFilteredEvents(list, 'puzzle')[0].type, 'puzzle');
});

test('useFilteredEvents returns the same array reference for "all"', () => {
  const list = [ev({})];
  assert.equal(useFilteredEvents(list, 'all'), list);
});

test('unclassified kinds survive "All" but vanish under a type filter', () => {
  const list = [ev({ type: 'class' }), ev({ type: 'tournament' }), ev({ type: 'file' })];
  assert.equal(useFilteredEvents(list, 'all').length, 3);
  assert.equal(useFilteredEvents(list, 'class').length, 1);
  assert.equal(useFilteredEvents(list, 'assignment').length, 0);
});

test('countByFilterType counts each bucket and totals "all"', () => {
  const list = [
    ev({ type: 'class' }), ev({ type: 'class' }),
    ev({ type: 'assignment' }), ev({ type: 'puzzle' }),
    ev({ type: 'tournament' }),
  ];
  const c = countByFilterType(list);
  assert.equal(c.all, 5);          // tournaments still count toward "All"
  assert.equal(c.class, 2);
  assert.equal(c.assignment, 1);
  assert.equal(c.puzzle, 1);
});

test('countsForDate only counts the given day', () => {
  const list = [
    ev({ type: 'class', date: '2026-10-12' }),
    ev({ type: 'puzzle', date: '2026-10-12' }),
    ev({ type: 'class', date: '2026-10-13' }),
  ];
  const c = countsForDate(list, '2026-10-12');
  assert.equal(c.all, 2);
  assert.equal(c.class, 1);
  assert.equal(c.puzzle, 1);
  assert.equal(c.assignment, 0);
});

test('filtering happens before grouping, so counts describe what is visible', () => {
  // 5 classes + 5 puzzles on one day: filtering to classes must yield exactly
  // the 5 classes, which is what "+N more" and "×14" would then count.
  const list = [
    ...Array.from({ length: 5 }, () => ev({ type: 'class' })),
    ...Array.from({ length: 5 }, () => ev({ type: 'puzzle' })),
  ];
  assert.equal(useFilteredEvents(list, 'class').length, 5);
  assert.equal(useFilteredEvents(list, 'puzzle').length, 5);
  assert.equal(countsForDate(useFilteredEvents(list, 'puzzle'), '2026-10-12').all, 5);
});