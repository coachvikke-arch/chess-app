/**
 * Chess puzzle logic module.
 *
 * A puzzle object has the shape:
 *   {
 *     id: "F2AL04",
 *     title: "Stalemate …",
 *     fen: "6k1/7r/4kn2/8/3R4/8/8/8 w - - 0 1",
 *     correctMoves: ["Rf4+", "Kxh7"],  // actual solution sequence (SAN)
 *     wrongMoves:   ["Ng8", "Kf6", "Re6"] // distractor/incorrect options
 *   }
 */

/** Requirement 2 — colour mapping used when colour-coding the output. */
export const COLOR = {
  correct: 'green',
  wrong: 'red',
};

/** Requirement 1 — validate one student move against the correct sequence. */
export function checkMove(puzzle, moveIndex, studentMove) {
  const correct = puzzle.correctMoves[moveIndex];
  const isCorrect = studentMove === correct;
  return {
    move: studentMove,
    isCorrect,
    color: isCorrect ? COLOR.correct : COLOR.wrong,
    status: isCorrect ? 'completed' : 'failed',
  };
}

/** Requirement 3 — evaluate a full attempt; 100 pts when the whole sequence
 *  is right, 0 as soon as any move is wrong. timeTaken left for the caller. */
export function evaluatePuzzleAttempt(puzzle, studentMoveList) {
  const results = (studentMoveList || []).map((move, i) => checkMove(puzzle, i, move));
  const allCorrect = results.length > 0 && results.every((r) => r.isCorrect);
  return {
    results,
    points: allCorrect ? 100 : 0,
    timeTaken: null,
  };
}

/** Requirement 5 — expose the model answer for display. */
export function showCorrectMoves(puzzle) {
  return Array.isArray(puzzle.correctMoves) ? [...puzzle.correctMoves] : [];
}

/** Requirement 4 — evaluate several puzzles (each with its own
 *  fen/correctMoves/wrongMoves) keyed by puzzle id. */
export function evaluatePuzzleSet(puzzles, attemptsByPuzzle = {}) {
  return (puzzles || []).map((puzzle) => {
    const list = attemptsByPuzzle[puzzle.id] || [];
    const evaluation = evaluatePuzzleAttempt(puzzle, list);
    return {
      puzzle: { id: puzzle.id, title: puzzle.title, fen: puzzle.fen },
      ...evaluation,
    };
  });
}

/** Normalise a raw puzzle row into the module's puzzle object. */
export function toPuzzle(raw) {
  const correctMoves = Array.isArray(raw?.correctMoves)
    ? raw.correctMoves
    : Array.isArray(raw?.solution)
      ? raw.solution
      : [];
  return {
    id: raw?.id ?? '',
    title: raw?.title ?? 'Puzzle',
    fen: raw?.fen ?? '',
    correctMoves,
    wrongMoves: Array.isArray(raw?.wrongMoves) ? raw.wrongMoves : [],
  };
}