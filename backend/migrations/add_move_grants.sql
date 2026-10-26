CREATE TABLE IF NOT EXISTS live_class_move_grants (
  live_class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  move_side VARCHAR(6) NOT NULL DEFAULT 'both', -- white | black | both
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (live_class_id, user_id)
);