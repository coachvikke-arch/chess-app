/* assignmentFlow pure-helper contract tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentPuzzlesSorted,
  assignmentResumeIndex,
  nextAssignmentPuzzleIndex,
  assignmentAllAttempted,
  assignmentAllSolved,
  assignmentAttemptedCount,
  assignmentSolvedCount,
} from '../src/lib/assignmentFlow.js';

const pu = (id, orderIndex, attemptResult) => ({ id, orderIndex, attemptResult });

test('sorted keeps assignment-facing puzzle order independent of id', () => {
  const puzzles = [pu(20, 3, 'correct'), pu(10, 1, 'not_started'), pu(15, 2, 'incorrect')];
  assert.deepEqual(assignmentPuzzlesSorted(puzzles).map((p) => p.id), [10, 15, 20]);
});

test('resume returns the first not-yet-solved puzzle (a failed one first)', () => {
  const puzzles = [pu(1, 0, 'correct'), pu(2, 1, 'incorrect'), pu(3, 2, 'not_started')];
  assert.equal(assignmentResumeIndex(puzzles), 1);
});

test('resume returns -1 when everything is solved (review / submit state)', () => {
  const puzzles = [pu(1, 0, 'correct'), pu(2, 1, 'correct')];
  assert.equal(assignmentResumeIndex(puzzles), -1);
});

test('next index walks forward and returns -1 after the last puzzle', () => {
  const puzzles = [pu(1, 0, 'not_started'), pu(2, 1, 'not_started'), pu(3, 2, 'not_started')];
  assert.equal(nextAssignmentPuzzleIndex(puzzles, 1), 1);
  assert.equal(nextAssignmentPuzzleIndex(puzzles, 2), 2);
  assert.equal(nextAssignmentPuzzleIndex(puzzles, 3), -1);
});

test('next index is -1 when current puzzle is not part of the assignment', () => {
  const puzzles = [pu(1, 0, 'not_started')];
  assert.equal(nextAssignmentPuzzleIndex(puzzles, 99), -1);
});

test('allAttempted is false until every puzzle has at least one recorded attempt', () => {
  const attempted = [pu(1, 0, 'correct'), pu(2, 1, 'incorrect')];
  const missing = [pu(1, 0, 'correct'), pu(2, 1, 'not_started')];
  assert.equal(assignmentAllAttempted(attempted), true);
  assert.equal(assignmentAllAttempted(missing), false);
  assert.equal(assignmentAllAttempted([]), false, 'an empty assignment is not submittable');
});

test('allSolved only when every puzzle is correct (0 solved never qualifies)', () => {
  assert.equal(assignmentAllSolved([pu(1, 0, 'correct')]), true);
  assert.equal(assignmentAllSolved([pu(1, 0, 'incorrect')]), false);
  assert.equal(assignmentAllSolved([pu(1, 0, 'correct'), pu(2, 1, 'not_started')]), false);
  assert.equal(assignmentAllSolved([]), false);
});

test('attempt counts derive from attemptResult', () => {
  const puzzles = [pu(1, 0, 'correct'), pu(2, 1, 'incorrect'), pu(3, 2, 'not_started')];
  assert.equal(assignmentAttemptedCount(puzzles), 2);
  assert.equal(assignmentSolvedCount(puzzles), 1);
});