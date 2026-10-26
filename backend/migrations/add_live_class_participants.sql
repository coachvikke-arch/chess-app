-- Live class participant roster with join/leave tracking and active status.
-- Additive and re-runnable (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS live_class_participants (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_class VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP DEFAULT NOW(),
  left_at TIMESTAMP NULL,
  UNIQUE (live_class_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_class_participants_class ON live_class_participants (live_class_id);
CREATE INDEX IF NOT EXISTS idx_live_class_participants_user ON live_class_participants (user_id);
