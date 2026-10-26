-- Add match-request notification support to the notifications table.
--   type          : 'match_request' (or NULL for plain notifications)
--   sender_id     : the user who triggered the notification (e.g. the challenger)
--   related_id    : the online_games.id this match request refers to
--   request_status: pending | accepted | declined | cancelled
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS related_id INTEGER,
  ADD COLUMN IF NOT EXISTS request_status VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_notifications_match_request
  ON notifications (type, related_id);