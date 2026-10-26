-- Keep pending chat requests in step with the target's CURRENT coach list.
--
-- WHY THIS EXISTS
-- ---------------
-- chat_request_approvers is a snapshot taken when the request was created, so a
-- request can end up with fewer approvers than the target now has:
--
--   * add_chat_request_approvers.sql adopted the single owning coach for requests
--     that already existed, because at that moment they genuinely had only one.
--   * A coach assigned AFTER a request was created never learns about it, even
--     though they can already open that student and would expect to decide.
--
-- The reported symptom was "the request only reaches the first admin". For a
-- student with several coaches that leaves a coach who is visibly responsible
-- for the student with no way to action the request, and the requester waiting on
-- someone who may never look.
--
-- So: pending requests are re-synced with the target's allocated coaches, and a
-- trigger keeps doing it going forward. Only PENDING rows are touched - a decided
-- request keeps the coach who actually decided it, because re-opening a decision
-- is not this migration's business.
--
-- Same "allocated" definition as coachScope() and resolveTargetCoachIds():
-- students.coach_id UNION student_coaches, group coach excluded.

-- ── SUPERSEDED ──────────────────────────────────────────────────────────────
-- Do NOT re-run this file on a current database.
--
-- It granted Approve/Reject to every coach allocated to the target and installed
-- a trigger doing the same for future assignments. The rule is now that the panel
-- is the two students' PRIMARY coaches plus Super Admin - see
-- add_chat_request_panel.sql, which drops the trigger and function below and
-- detaches the extra coaches this file added.
--
-- Kept only as a record of the earlier behaviour.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Backfill requests that are still waiting ─────────────────────────────
-- can_decide is FALSE: the target's coaches observe, the REQUESTER's primary
-- coach decides (see add_chat_request_decider.sql).
INSERT INTO chat_request_approvers (chat_request_id, coach_id, can_decide)
SELECT cr.id, alloc.coach_id, FALSE
  FROM chat_requests cr
  JOIN students tgt ON tgt.user_id = cr.target_user_id
  CROSS JOIN LATERAL (
    SELECT tgt.coach_id AS coach_id
     WHERE tgt.coach_id IS NOT NULL
    UNION
    SELECT sc.coach_id
      FROM student_coaches sc
     WHERE sc.student_id = tgt.id
  ) alloc
 WHERE cr.status = 'pending'
ON CONFLICT (chat_request_id, coach_id) DO NOTHING;

-- ── 2. Keep doing it when a coach is assigned later ──────────────────────────
CREATE OR REPLACE FUNCTION chat_request_approvers_add_new_coach()
RETURNS TRIGGER AS $$
BEGIN
  /* A newly allocated coach inherits the target's PENDING requests as an
     OBSERVER, so they can see the history without gaining the right to decide
     a request that belongs to the requester's own coach. */
  INSERT INTO chat_request_approvers (chat_request_id, coach_id, can_decide)
  SELECT cr.id, NEW.coach_id, FALSE
    FROM chat_requests cr
    JOIN students s ON s.user_id = cr.target_user_id
   WHERE cr.status = 'pending'
     AND s.id = NEW.student_id
  ON CONFLICT (chat_request_id, coach_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_request_approvers_new_coach ON student_coaches;
CREATE TRIGGER trg_chat_request_approvers_new_coach
  AFTER INSERT ON student_coaches
  FOR EACH ROW EXECUTE FUNCTION chat_request_approvers_add_new_coach();