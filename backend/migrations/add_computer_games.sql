-- Computer Games History - stores games played against Stockfish/Computer engine
-- Run: psql <db> -f backend/migrations/add_computer_games.sql

CREATE TABLE IF NOT EXISTS computer_games (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_color VARCHAR(5) NOT NULL,
  computer_level INTEGER NOT NULL DEFAULT 10,
  fen VARCHAR(120) NOT NULL,
  pgn TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'finished',
  result VARCHAR(20),
  result_reason VARCHAR(50),
  moves_count INTEGER DEFAULT 0,
  time_base_minutes INTEGER NOT NULL DEFAULT 5,
  time_increment_seconds INTEGER NOT NULL DEFAULT 0,
  analysis_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_computer_games_student ON computer_games (student_user_id);
CREATE INDEX IF NOT EXISTS idx_computer_games_created ON computer_games (created_at DESC);

ALTER TABLE computer_games ADD COLUMN IF NOT EXISTS analysis_aggregated_at TIMESTAMP;
