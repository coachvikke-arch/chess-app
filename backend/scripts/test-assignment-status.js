/* deriveStudentSubmissionStatus contract tests.
 *
 * This function decides the student-facing status of a puzzle assignment. The
 * old attempt flow wrote `submitted`/`submitted_at` on any scored attempt, so
 * the rules here guard the two invariants that matter:
 *   1. a submission can only ever be reported once a real one was persisted
 *      (submitted_at written by the explicit submit flow, or a coach review),
 *   2. overdue is a due-date fact, and a handed-in assignment is never demoted
 *      to overdue.
 *
 * Run: node --test scripts/test-assignment-status.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { deriveStudentSubmissionStatus } = require('../src/utils/assignmentStatus');

const base = {
  storedStatus: 'pending',
  submittedAt: null,
  reviewedAt: null,
  dueDate: null,
  attemptedCount: 0,
  solvedCount: 0,
  totalCount: 3,
};

test('nothing attempted → pending', () => {
  assert.equal(deriveStudentSubmissionStatus(base), 'pending');
});

test('any scored attempt → in_progress, never submitted', () => {
  assert.equal(deriveStudentSubmissionStatus({ ...base, attemptedCount: 1, solvedCount: 0 }), 'in_progress');
  assert.equal(deriveStudentSubmissionStatus({ ...base, attemptedCount: 3, solvedCount: 1 }), 'in_progress');
});

test('a wrong first attempt (0 solved) can never read as submitted', () => {
  // This exact row (status='submitted' + submitted_at, score NULL) was produced
  // by the old attemptPuzzle bug. The explicit submit flow always writes a
  // score in the same UPDATE, so a NULL score is proof no real hand-in happened
  // — the derivation must not trust the stored status by itself.
  const corrupt = { ...base, storedStatus: 'submitted', submittedAt: new Date('2026-01-01T10:00:00Z'), attemptedCount: 1, solvedCount: 0 };
  assert.equal(deriveStudentSubmissionStatus(corrupt), 'in_progress');
});

test('an explicit submission with a matching stored status + score → submitted', () => {
  const done = {
    ...base,
    storedStatus: 'submitted',
    submittedAt: new Date('2026-01-05T10:00:00Z'),
    storedScore: 30,
    attemptedCount: 3,
    solvedCount: 3,
  };
  assert.equal(deriveStudentSubmissionStatus(done), 'submitted');
});

test('reviewed_at wins over everything', () => {
  const reviewed = {
    ...base,
    storedStatus: 'submitted',
    submittedAt: new Date('2026-01-05T10:00:00Z'),
    storedScore: 30,
    reviewedAt: new Date('2026-01-06T10:00:00Z'),
    attemptedCount: 3,
    solvedCount: 3,
  };
  assert.equal(deriveStudentSubmissionStatus(reviewed), 'reviewed');
});

test('overdue when due date passed and not handed in', () => {
  const past = new Date('2026-01-31T10:00:00Z');
  assert.equal(
    deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-10', now: past, attemptedCount: 0 }),
    'overdue',
  );
  assert.equal(
    deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-10', now: past, attemptedCount: 2, solvedCount: 1 }),
    'overdue',
  );
});

test('handed-in assignments are never demoted to overdue', () => {
  const now = new Date('2026-01-31T10:00:00Z');
  const submitted = {
    ...base,
    storedStatus: 'submitted',
    submittedAt: new Date('2026-01-20T10:00:00Z'),
    storedScore: 30,
    dueDate: '2026-01-10',
    attemptedCount: 3,
    solvedCount: 3,
    now,
  };
  const reviewed = { ...submitted, reviewedAt: new Date('2026-01-21T10:00:00Z') };
  assert.equal(deriveStudentSubmissionStatus(submitted), 'submitted');
  assert.equal(deriveStudentSubmissionStatus(reviewed), 'reviewed');
});

test('due date still in the future → work continues as in_progress/pending', () => {
  const now = new Date('2026-01-05T10:00:00Z');
  assert.equal(
    deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-31', now, attemptedCount: 1 }),
    'in_progress',
  );
  assert.equal(
    deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-31', now, attemptedCount: 0 }),
    'pending',
  );
});

test('due the same day stays available until the day passes', () => {
  const noon = new Date('2026-01-10T12:00:00Z');
  assert.equal(deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-10', now: noon }), 'pending');
  const nextDay = new Date('2026-01-11T00:00:01Z');
  assert.equal(deriveStudentSubmissionStatus({ ...base, dueDate: '2026-01-10', now: nextDay }), 'overdue');
});