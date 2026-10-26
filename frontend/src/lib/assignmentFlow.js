// Pure helpers for the student puzzle-assignment solving flow.
// Each puzzle in an assignment is `{ id, orderIndex, attemptResult }` where
// attemptResult is 'correct' | 'incorrect' | 'not_started'.

export function assignmentPuzzlesSorted(puzzles = []) {
  return [...puzzles].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

// Index of the first "not yet solved" puzzle (attemptResult !== 'correct').
// Returns -1 when every puzzle has already been solved.
export function assignmentResumeIndex(puzzles = []) {
  return assignmentPuzzlesSorted(puzzles).findIndex((p) => p.attemptResult !== 'correct');
}

// Index of the puzzle right after `currentId`, or -1 when `currentId` is the
// last puzzle (or is not part of this assignment at all).
export function nextAssignmentPuzzleIndex(puzzles = [], currentId) {
  const ordered = assignmentPuzzlesSorted(puzzles);
  const i = ordered.findIndex((p) => p.id === currentId);
  if (i === -1) return -1;
  return i + 1 < ordered.length ? i + 1 : -1;
}

export function assignmentAllAttempted(puzzles = []) {
  return puzzles.length > 0 && puzzles.every((p) => p.attemptResult && p.attemptResult !== 'not_started');
}

export function assignmentAllSolved(puzzles = []) {
  return puzzles.length > 0 && puzzles.every((p) => p.attemptResult === 'correct');
}

export function assignmentAttemptedCount(puzzles = []) {
  return puzzles.filter((p) => p.attemptResult && p.attemptResult !== 'not_started').length;
}

export function assignmentSolvedCount(puzzles = []) {
  return puzzles.filter((p) => p.attemptResult === 'correct').length;
}