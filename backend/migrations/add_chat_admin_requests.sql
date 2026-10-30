-- Student <-> allocated-admin chat requests.
--
-- WHY A NEW TABLE INSTEAD OF MORE ROWS IN chat_requests
-- chat_requests is the PEER queue: a student asks to message a classmate and the
-- two coaches plus Super Admin decide it as a panel. That shape does not fit this
-- rule. Here the requester is always the student, exactly ONE named admin decides,
-- the outcome vocabulary is accept/cancel (there is no refusal - the admin either
-- opens the channel or drops the request), and being allocated is a precondition
-- the peer table has no notion of. Overloading it would mean a nullable
-- "who decides" column that means "the panel" for one row type and "this one
-- admin" for another, and every existing query in chatRequestController would have
-- to learn to exclude half of its own rows. One table per rule keeps both honest.
--
-- IDs ARE USER IDs, NOT students.id
-- Everything in the messenger is keyed on users.id, and this project already has
-- the students.id / users.id trap (student_coaches.student_id points at
-- students.id). Both columns here reference users(id) and are named *_user_id so
-- the mistake cannot be made by reading a bare "student_id".

CREATE TABLE IF NOT EXISTS chat_admin_requests (
  id               SERIAL PRIMARY KEY,
  student_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /* Only three states, on purpose. There is no 'rejected': the admin's two
     actions are Accept and Cancel, and Cancel is a withdrawal of the request
     rather than a refusal on the merits - which is also why a cancelled student
     may ask again at once instead of sitting out the peer flow's cooldown. */
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'cancelled')),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMP,
  /* NULL on the backfilled rows below: those pairs were never asked about, the
     migration simply grandfathered an existing supervised channel. */
  accepted_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at     TIMESTAMP,
  cancelled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ck_chat_admin_requests_not_self CHECK (student_user_id <> admin_user_id)
);

-- One live request per pair. A student cannot stack pending requests at their
-- coach, and cannot hold an accepted and a pending row at the same time. The
-- index is PARTIAL because an ordinary UNIQUE constraint would also refuse the
-- second cancellation, and the history of cancelled requests is kept so a coach
-- can see that a student has asked before.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_admin_requests_one_active
    ON chat_admin_requests (student_user_id, admin_user_id)
    WHERE status IN ('pending', 'accepted');

-- The two reads that happen on every People list: "the admin's pending queue"
-- and "does this pair have a live request".
CREATE INDEX IF NOT EXISTS idx_chat_admin_requests_admin
    ON chat_admin_requests (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_admin_requests_student
    ON chat_admin_requests (student_user_id, created_at DESC);

-- AUTO-ACCEPT THE CHANNELS THAT ALREADY EXIST.
--
-- The gate turns a currently-open student<->coach chat into one that needs an
-- accepted request, so without this every live thread would go dark mid-conversation
-- the moment this is applied. Any allocated pair that has already exchanged
-- private messages, or that an earlier approval already opened, is recorded as
-- accepted. Nothing is deleted and no message moves, so there is no data loss -
-- this only writes the paperwork for contact that was already happening.
--
-- Allocation is read from the live roster (students.coach_id for the primary
-- coach plus every student_coaches row), which is the same source the gate uses
-- at request time. A pair that talked but is NOT allocated today is deliberately
-- left unbackfilled: the spec wants a re-allocated student to lose the old chat
-- and ask their new coach, so history alone must not grant access.
WITH allocated AS (
  SELECT s.user_id AS student_user_id, c.id AS admin_user_id
    FROM students s
    JOIN users c ON c.id = s.coach_id AND c.role IN ('admin', 'superadmin')
   WHERE s.user_id IS NOT NULL
  UNION
  SELECT s.user_id AS student_user_id, sc.coach_id AS admin_user_id
    FROM students s
    JOIN student_coaches sc ON sc.student_id = s.id
    JOIN users c ON c.id = sc.coach_id AND c.role IN ('admin', 'superadmin')
   WHERE s.user_id IS NOT NULL
),
paired AS (
  SELECT a.student_user_id, a.admin_user_id
    FROM allocated a
   WHERE EXISTS (
     SELECT 1
       FROM chat_messages m
      WHERE m.is_private IS TRUE
        AND ((m.sender_id = a.student_user_id AND m.recipient_id = a.admin_user_id)
          OR (m.sender_id = a.admin_user_id AND m.recipient_id = a.student_user_id))
   )
      OR EXISTS (
     SELECT 1
       FROM conversations cv
      WHERE cv.status = 'active'
        AND ((cv.user1_id = a.student_user_id AND cv.user2_id = a.admin_user_id)
          OR (cv.user1_id = a.admin_user_id AND cv.user2_id = a.student_user_id))
   )
)
INSERT INTO chat_admin_requests
        (student_user_id, admin_user_id, status, created_at, updated_at, accepted_at)
SELECT p.student_user_id,
       p.admin_user_id,
       'accepted',
       NOW(), NOW(), NOW()
  FROM paired p
 WHERE NOT EXISTS (
   /* The NOT EXISTS is the re-runnability guard. ON CONFLICT could infer the
      partial index instead, but spelling the predicate out means a second run
      of this file provably changes nothing. */
   SELECT 1
     FROM chat_admin_requests r
    WHERE r.student_user_id = p.student_user_id
      AND r.admin_user_id = p.admin_user_id
      AND r.status IN ('pending', 'accepted')
 );
