-- The decision panel: the two students' primary coaches AND Super Admin.
--
-- CHANGES THE RULE (supersedes add_chat_request_decider.sql, which made the
-- requester's coach the sole decider and left everyone else a read-only observer):
--
--   PANEL   requester's primary coach, target's primary coach, every Super Admin.
--           All three see who gave the request to whom, and all three may APPROVE
--           or REJECT it. First action wins.
--
-- Rationale: anyone accountable for either student can stop a request, so a
-- pairing one admin considers unsuitable cannot be waved through by another. The
-- cost is that approval is no longer a single owner's decision - which is the
-- intended trade.
--
-- PRIMARY coaches only. A student's additional coaches (student_coaches) are NOT
-- in the panel, so the extra-coach sync trigger is dropped below: it existed only
-- to give newly assigned (non-primary) coaches visibility, which this rule
-- removes. can_decide is kept and is TRUE for every panel member; it stays so the
-- queue can filter on it and so a future read-only observer type needs no
-- migration.

-- 1. Detach anyone the new rule excludes (previously-synced extra coaches).
--    Done first so they cannot linger with authority over a request.
DELETE FROM chat_request_approvers a
  USING chat_requests cr
 WHERE a.chat_request_id = cr.id
   AND a.coach_id IS DISTINCT FROM (SELECT rs.coach_id FROM students rs
                                     WHERE rs.user_id = cr.requester_user_id)
   AND a.coach_id IS DISTINCT FROM (SELECT ts.coach_id FROM students ts
                                     WHERE ts.user_id = cr.target_user_id)
   AND a.coach_id NOT IN (SELECT id FROM users WHERE role = 'superadmin');

-- 2. Attach the full panel to every request, and make them all able to decide.
--    The requester's coach is usually absent from legacy rows (they recorded only
--    the target's coaches), so without this a request could be unanswerable.
INSERT INTO chat_request_approvers (chat_request_id, coach_id, can_decide)
SELECT cr.id, party.coach_id, TRUE
  FROM chat_requests cr
  CROSS JOIN LATERAL (
    SELECT (SELECT rs.coach_id FROM students rs WHERE rs.user_id = cr.requester_user_id) AS coach_id
    UNION
    SELECT (SELECT ts.coach_id FROM students ts WHERE ts.user_id = cr.target_user_id)
    UNION
    SELECT id FROM users WHERE role = 'superadmin'
  ) party
 WHERE party.coach_id IS NOT NULL
ON CONFLICT (chat_request_id, coach_id) DO UPDATE SET can_decide = TRUE;

-- 3. Everyone attached is panel, so everyone attached can decide.
UPDATE chat_request_approvers SET can_decide = TRUE;

-- 4. Retire the extra-coach sync. A student's additional coaches are not in the
--    panel, so inheriting pending requests would hand authority to an account the
--    rule deliberately excludes.
DROP TRIGGER IF EXISTS trg_chat_request_approvers_new_coach ON student_coaches;
DROP FUNCTION IF EXISTS chat_request_approvers_add_new_coach();