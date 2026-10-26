-- One decider per request: the REQUESTER's primary coach.
--
-- WHY
-- ---
-- chat_request_approvers originally granted Approve/Reject to every coach
-- allocated to the target. That turned a single approval into a race between
-- colleagues, and it made "who do I ask?" ambiguous for the student.
--
-- The rule is now:
--
--   DECIDER   the requester's primary coach (students.coach_id of the REQUESTER).
--             Falls back to the first superadmin when the requester has no coach,
--             so a request is never dead-ended.
--   OBSERVERS the target's primary coach, and superadmins. They are notified and
--             can read the request and its history, but cannot decide it.
--
-- The student's own coach is the decider because the coach responsible for the
-- requester is the one accountable for that student's contacts - the same reason
-- the messenger gate treats staff/student pairs as pre-approved and only
-- student/student pairs as needing a decision at all.
--
-- `can_decide` is stored rather than derived, because "who may act" is an
-- authorisation fact about THIS request, not a live function of current
-- assignments: a coach assigned tomorrow must not inherit authority over a
-- request they were never asked about (that is what sync_chat_request_approvers
-- deliberately does NOT do - it adds them as an observer only).
--
-- Existing rows are normalised so behaviour is uniform across the whole table:
-- the requester's primary coach keeps can_decide, everyone else becomes an
-- observer.
ALTER TABLE chat_request_approvers
  ADD COLUMN IF NOT EXISTS can_decide BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE chat_request_approvers a
   SET can_decide = FALSE
  FROM chat_requests cr
  JOIN students rs ON rs.user_id = cr.requester_user_id
 WHERE a.chat_request_id = cr.id
   AND a.coach_id IS DISTINCT FROM rs.coach_id;

/* Every PENDING request must end up with somebody able to answer it.
 *
 * Rows written before this rule recorded only the TARGET's coaches, so a request
 * raised while the old code was live can be left with no decider at all - it would
 * sit pending forever with an empty queue and no way for anyone to action it.
 * Upserting the requester's primary coach closes that hole and is idempotent; it
 * also re-promotes the decider if the UPDATE above demoted them.
 *
 * NOT NULL on coach_id keeps unassigned requesters out: they legitimately have no
 * decider here and are handled by the no-coach fallback at creation time. */
INSERT INTO chat_request_approvers (chat_request_id, coach_id, can_decide)
SELECT cr.id, rs.coach_id, TRUE
  FROM chat_requests cr
  JOIN students rs ON rs.user_id = cr.requester_user_id
 WHERE cr.status = 'pending'
   AND rs.coach_id IS NOT NULL
ON CONFLICT (chat_request_id, coach_id) DO UPDATE SET can_decide = TRUE;

-- The coach queue filters on this on every visit.
CREATE INDEX IF NOT EXISTS idx_chat_request_approvers_decide
  ON chat_request_approvers (can_decide, coach_id, chat_request_id);