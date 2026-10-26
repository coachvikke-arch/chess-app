-- Repair: puzzle-assignment submissions falsely marked "submitted".
--
-- The old attemptPuzzle flow ran, on every scored attempt (correct OR failed,
-- even 0 solved), an UPDATE that set
--     status = 'submitted',
--     submitted_at = COALESCE(submitted_at, NOW())
-- and left `score` untouched (NULL). So a student who merely opened the first
-- puzzle looked like they had handed the assignment in.
--
-- Genuine submissions are written by the explicit submit flow, which always
-- stores `score` and `progress_completed`, or by the coach review flow, which
-- always writes `reviewed_at`. Therefore:
--
--   status = 'submitted' AND reviewed_at IS NULL AND score IS NULL
--           AND submitted_at IS NOT NULL
--
-- can only be the bug's output. Those rows are recomputed from the attempt
-- data and their false submitted_at is cleared. puzzle_attempts history is
-- never touched, so no student's progress is lost.
--
-- Run: node run_migration_repair_puzzle_assignment_status.js

BEGIN;

UPDATE assignment_submissions sub
SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM puzzle_attempts pa
        WHERE pa.student_id = sub.student_id
          AND pa.puzzle_assignment_id = sub.assignment_id
      ) THEN 'in_progress'
      ELSE 'pending'
    END,
    submitted_at = NULL,
    progress_completed = (
      SELECT COUNT(DISTINCT pa.puzzle_id)::int
      FROM puzzle_attempts pa
      WHERE pa.student_id = sub.student_id
        AND pa.puzzle_assignment_id = sub.assignment_id
        AND pa.result = 'correct'
    )
WHERE sub.status = 'submitted'
  AND sub.reviewed_at IS NULL
  AND sub.score IS NULL
  AND sub.submitted_at IS NOT NULL
  AND sub.assignment_id IN (
    SELECT id FROM assignments WHERE type = 'puzzle_assignment'
  );

COMMIT;