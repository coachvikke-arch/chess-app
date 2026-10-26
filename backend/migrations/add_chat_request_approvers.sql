-- Multiple coaches per chat request.
--
-- ORDERING
-- -------
-- Must run AFTER add_chat_requests.sql (it references chat_requests) and after
-- add_student_coaches.sql (it reads student_coaches for the backfill). Both are
-- separate migration files and this project applies migrations in order.
--
-- WHY A JOIN TABLE
-- ---------------
-- A student can be handled by several coaches at once: `students.coach_id` is
-- only the PRIMARY coach, and `student_coaches` holds every additional one. That
-- is already the app's definition of "assigned", used by coachScope() to decide
-- which students a coach may open:
--
--     s.coach_id = $1 OR EXISTS (SELECT 1 FROM student_coaches sc
--                                 WHERE sc.student_id = s.id AND sc.coach_id = $1)
--
-- `chat_requests.target_coach_id` is a single column, so a request could only
-- ever reach ONE of those coaches. Anyone else who can already see the student
-- had no way to action their request, and the requester's only path was the
-- single primary coach.
--
-- So authority moves to this table. `chat_requests.target_coach_id` is KEPT as
-- the primary/owning coach: it stays the answer to "who owns this", it preserves
-- the existing no-coach superadmin fallback, and it keeps older rows and clients
-- working. Membership here is what grants the right to decide.
--
-- The PK is the whole point: one approver appears once per request, so a
-- double-assigned coach cannot weigh in twice.
--
-- No status lives here. Approval remains a single irreversible transition on
-- chat_requests; this table only answers "who was asked".

CREATE TABLE IF NOT EXISTS chat_request_approvers (
  chat_request_id INTEGER NOT NULL REFERENCES chat_requests(id) ON DELETE CASCADE,
  coach_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_request_id, coach_id)
);

-- The coach queue reads this on every visit: "requests I was asked to decide".
CREATE INDEX IF NOT EXISTS idx_chat_request_approvers_coach
  ON chat_request_approvers (coach_id, chat_request_id);

-- Adopt the existing single approver so requests already in flight are not
-- orphaned: their current owner must keep the ability to decide them.
INSERT INTO chat_request_approvers (chat_request_id, coach_id)
SELECT cr.id, cr.target_coach_id
  FROM chat_requests cr
 WHERE cr.target_coach_id IS NOT NULL
ON CONFLICT (chat_request_id, coach_id) DO NOTHING;