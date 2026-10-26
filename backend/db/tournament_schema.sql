-- Tournament schema for the academy.

-- Create tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  format VARCHAR(32) NOT NULL DEFAULT 'swiss',
  status VARCHAR(32) NOT NULL DEFAULT 'upcoming',
  visibility VARCHAR(32) NOT NULL DEFAULT 'private',
  time_minutes INTEGER NOT NULL DEFAULT 10,
  increment_seconds INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 10,
  current_round INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  end_time TIMESTAMP,
  max_players INTEGER NOT NULL DEFAULT 32,
  min_players INTEGER NOT NULL DEFAULT 2,
  allow_berserk BOOLEAN NOT NULL DEFAULT true,
  allow_draw_offers BOOLEAN NOT NULL DEFAULT true,
  auto_advance BOOLEAN NOT NULL DEFAULT true,
  auto_start BOOLEAN NOT NULL DEFAULT false,
  self_register BOOLEAN NOT NULL DEFAULT false,
  no_show_seconds INTEGER NOT NULL DEFAULT 300,
  winner_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create tournament_registrations table
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  seed INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  paused BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  left_at TIMESTAMP,
  player_status VARCHAR(32) NOT NULL DEFAULT 'active',
  invitation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create tournament_pairings table with round_no column
CREATE TABLE IF NOT EXISTS tournament_pairings (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL DEFAULT 1,
  board_no INTEGER NOT NULL,
  white_player INTEGER REFERENCES users(id),
  black_player INTEGER REFERENCES users(id),
  bye BOOLEAN NOT NULL DEFAULT false,
  result VARCHAR(16),
  winner_player INTEGER REFERENCES users(id),
  white_points DECIMAL DEFAULT 0,
  black_points DECIMAL DEFAULT 0,
  white_berserk BOOLEAN DEFAULT false,
  black_berserk BOOLEAN DEFAULT false,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create tournament_games table
CREATE TABLE IF NOT EXISTS tournament_games (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  white_player INTEGER REFERENCES users(id),
  black_player INTEGER REFERENCES users(id),
  current_round INTEGER NOT NULL DEFAULT 1,
  moves_count INTEGER NOT NULL DEFAULT 0,
  result VARCHAR(16),
  pgn TEXT,
  fen TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create tournament_progression table (used by roundProgressionService)
CREATE TABLE IF NOT EXISTS tournament_progression (
  id BIGSERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  reason VARCHAR(64) NOT NULL DEFAULT 'game_finalized',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for tournament_pairings
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_t ON tournament_pairings (tournament_id, round_no);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_rb ON tournament_pairings (round_no, board_no NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_wh ON tournament_pairings (white_player);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_bl ON tournament_pairings (black_player);

-- Create indexes for tournament_registrations
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_t ON tournament_registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_s ON tournament_registrations (student_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_sr ON tournament_registrations (tournament_id, status);

-- Create indexes for tournament_games
CREATE INDEX IF NOT EXISTS idx_tournament_games_t ON tournament_games (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_games_s ON tournament_games (status);

-- Create indexes for tournament_progression
CREATE INDEX IF NOT EXISTS idx_tournament_progression_pending ON tournament_progression (status, available_at, id);

-- Grant permissions (adjust as needed for your setup)
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;