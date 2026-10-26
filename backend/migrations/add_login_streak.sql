-- Daily login streak tracking.
-- Tracks the last day a user signed in + how many consecutive calendar days
-- they have kept that login alive. Updated on login and on student dashboard load.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER NOT NULL DEFAULT 0;