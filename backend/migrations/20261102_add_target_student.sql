-- Add target_student_user_id column to chat_admin_requests for student-to-student requests.
--
-- This column is NULL when the request is student->admin,
-- and contains the target student's user id when the request is student->student.
-- Example: Kevin requests to chat with Manivel M -> target_student_user_id = Manivel's user id
-- Student requests to chat with admin -> target_student_user_id = NULL

ALTER TABLE chat_admin_requests
ADD COLUMN target_student_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Update the unique index to include target_student_user_id so that:
-- (student A, admin X) is one request
-- (student A, admin X, student B) is a different request from (student A, admin X, student C)
DROP INDEX IF EXISTS uq_chat_admin_requests_one_active ON chat_admin_requests;
CREATE UNIQUE INDEX uq_chat_admin_requests_one_active
    ON chat_admin_requests (student_user_id, admin_user_id, target_student_user_id)
    WHERE status IN ('pending', 'accepted');

-- Update the auto-accept query to also consider target_student_user_id
-- (the existing auto-accept logic already handles re-runnability via NOT EXISTS)
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
    SELECT 1
      FROM chat_admin_requests r
     WHERE r.student_user_id = p.student_user_id
       AND r.admin_user_id = p.admin_user_id
       AND r.status IN ('pending', 'accepted')
 );