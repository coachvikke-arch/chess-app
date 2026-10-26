-- Chess game state for integrated live classes: shared board position, moves, annotations.
-- Additive and re-runnable (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS chess_game_states (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  fen VARCHAR(120) NOT NULL,
  pgn TEXT DEFAULT '',
  current_turn VARCHAR(5) NOT NULL DEFAULT 'w',
  annotations JSONB NOT NULL DEFAULT '{"arrows":[],"highlights":[]}',
  last_move JSONB NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (live_class_id)
);
