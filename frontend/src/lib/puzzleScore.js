/* The trainer's scoring words and its one timing constant.
 *
 * The POINTS are decided on the server (backend/src/services/puzzleTrainerScore.js)
 * and arrive with the solve response — nothing here recomputes an award, because a
 * second copy of the rule is how the board and the ladder start disagreeing.
 *
 * What this owns is the wording both surfaces read, and the delay the page waits
 * before the next position: long enough to read the award and watch the mating
 * move land, short enough that the feed still feels endless.
 */

/* The board stays locked for exactly this long after a solve. Exported so the
   contract test asserts the number the page actually schedules with. */
export const NEXT_DELAY_MS = 3000;

/**
 * The status line once the server has answered.
 * @param {{credited: boolean, points: number, messy: boolean}} award
 */
export function solveMessage({ credited, points, messy }) {
  if (!credited) return 'Solved again — this puzzle is already counted.';
  return `${messy ? 'Solved' : 'Correct'}! +${points} point${points === 1 ? '' : 's'}`;
}

/** One line explaining the award, from the rules the server sent with the ladder. */
export function scoringNote(scoring) {
  if (!scoring) return '';
  const parts = [
    `First try +${scoring.first_try}`,
    `after a miss +${scoring.after_miss}`,
    `wrong move ${scoring.wrong_move}`,
  ];
  if (scoring.speed_bonus > 0) {
    parts.push(`under ${Math.round(scoring.speed_window_ms / 1000)}s +${scoring.speed_bonus}`);
  }
  return parts.join(' · ');
}