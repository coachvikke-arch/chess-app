/**
 * Student-facing status for a puzzle assignment submission.
 *
 * The stored `assignment_submissions.status` column is written by three flows:
 * attempts, the explicit student "Submit Assignment" action, and the coach
 * review action. A bug in the attempt flow used to record `submitted` +
 * `submitted_at` on ANY scored attempt (even a wrong one with 0 solves), which
 * made every started assignment look handed in.
 *
 * Deriving the status from the authoritative timestamps + attempt data means a
 * stale stored status can never falsely report a submission once the source is
 * fixed and the repair migration has run.
 *
 * Rules (order matters):
 *   - reviewed        → coach reviewed it (reviewed_at set by the review flow)
 *   - submitted       → a real submission was persisted (submitted_at set by
 *                       the explicit submit flow with a matching stored status)
 *   - overdue         → due date passed and it was not handed in
 *   - in_progress     → any scored attempt exists
 *   - pending         → nothing attempted yet
 */
function deriveStudentSubmissionStatus({
  storedStatus,
  submittedAt,
  reviewedAt,
  dueDate,
  storedScore = null,
  attemptedCount = 0,
  solvedCount = 0,
  totalCount = 0,
  now = new Date(),
}) {
  if (reviewedAt) return 'reviewed';
  // A genuine hand-in is written by the explicit submit flow, which always
  // stores `score` and `submitted_at` in the same UPDATE (and can never leave
  // score NULL). The old attempt-bug wrote submitted_at with score NULL, so
  // requiring a non-null score is what makes the corrupt rows un-submittable.
  if (submittedAt && storedScore != null && (storedStatus === 'submitted' || storedStatus === 'reviewed')) {
    return 'submitted';
  }
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (dueDate && new Date(dueDate) < startOfToday) return 'overdue';
  if (attemptedCount > 0) return 'in_progress';
  return 'pending';
}

module.exports = { deriveStudentSubmissionStatus };