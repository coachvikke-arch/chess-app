-- Permanent Academy reward unlocks. The unique key guarantees idempotency.
CREATE TABLE IF NOT EXISTS academy_reward_unlocks (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level_slug TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, reward_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_reward_unlocks_student
  ON academy_reward_unlocks (student_id, unlocked_at DESC);
