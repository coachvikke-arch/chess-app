/* Live-classroom "X joined" toast logic.
 *
 * Run: node --test scripts/join-toast.test.mjs
 *
 * Covers the pure stack reducer (stack-up-to-3 / collapse-to-a-group), the
 * hover-aware prune, and the per-viewer wording ("You joined" vs "X joined").
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendJoinToast,
  pruneJoinToasts,
  describeJoin,
  MAX_VISIBLE_JOIN_TOASTS,
  JOIN_TOAST_MS,
} from '../src/utils/joinToastStack.js';

const entry = (id, name = `S${id}`) => ({
  id,
  name,
  initial: name.charAt(0),
  title: 'Student joined',
  message: `${name} joined the class`,
  bornAt: 0,
});

test('first arrivals stack individually', () => {
  const list = [entry(1), entry(2), entry(3)].reduce((acc, e) => appendJoinToast(acc, e), []);
  assert.equal(list.length, MAX_VISIBLE_JOIN_TOASTS);
  assert.ok(list.every((t) => t.kind === 'single'));
});

test('a fourth arrival collapses the stack into a grouped count', () => {
  let list = [];
  for (let i = 1; i <= 4; i += 1) list = appendJoinToast(list, entry(i));
  assert.equal(list.length, 1, 'one grouped card replaces the individual ones');
  assert.equal(list[0].kind, 'group');
  assert.equal(list[0].count, 4);
  assert.equal(list[0].message, '4 students joined');
});

test('further arrivals grow the existing group instead of adding cards', () => {
  let list = [];
  for (let i = 1; i <= 6; i += 1) list = appendJoinToast(list, entry(i));
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 6);
  assert.equal(list[0].message, '6 students joined');
});

test('appending never mutates the caller\'s array', () => {
  const base = [entry(1)];
  const next = appendJoinToast(base, entry(2));
  assert.equal(base.length, 1);
  assert.equal(next.length, 2);
});

test('expired cards are pruned, held cards survive their lifetime', () => {
  const list = [
    { id: 1, bornAt: 0, kind: 'single' },
    { id: 2, bornAt: 0, kind: 'single' },
  ];
  const kept = pruneJoinToasts(list, { now: JOIN_TOAST_MS + 1, isHeld: (id) => id === 2 });
  assert.deepEqual(kept.map((t) => t.id), [2]);
});

test('a fresh card is not pruned before its lifetime', () => {
  const list = [{ id: 1, bornAt: 1000, kind: 'single' }];
  assert.equal(pruneJoinToasts(list, { now: 1000 + JOIN_TOAST_MS - 1 }).length, 1);
});

test('the joiner sees a personal confirmation, others see the arrival', () => {
  const mine = describeJoin({ name: 'Ana', role: 'student', className: 'Openings 101', isMe: true });
  assert.equal(mine.message, 'You joined Openings 101');
  assert.equal(mine.title, 'Welcome');

  const other = describeJoin({ name: 'Ana', role: 'student', className: 'Openings 101', isMe: false });
  assert.equal(other.message, 'Ana joined the class');
  assert.equal(other.title, 'Student joined');
});

test('a coach joining is announced as the coach', () => {
  const coach = describeJoin({ name: 'Coach Bob', role: 'host', className: 'Openings 101', isMe: false });
  assert.equal(coach.title, 'Coach joined');
  assert.equal(coach.message, 'Coach Bob joined the class');
});

test('a nameless joiner still produces readable text', () => {
  const p = describeJoin({ name: '   ', role: 'student', className: 'X', isMe: false });
  assert.equal(p.message, 'Someone joined the class');
  const mine = describeJoin({ name: '', role: 'student', isMe: true });
  assert.equal(mine.message, 'You joined the class', 'missing class name falls back gracefully');
});
