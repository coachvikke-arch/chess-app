-- Unified Chess Profile Import — Chess.com / Lichess integration
-- Run: node run_migration.js add_chess_profiles.sql

-- One row per connected external chess account (Chess.com / Lichess).
CREATE TABLE IF NOT EXISTS connected_chess_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('chess.com', 'lichess')),
  username VARCHAR(100),
  profile_url TEXT,
  avatar TEXT,
  title VARCHAR(20),
  country VARCHAR(60),
  country_code VARCHAR(10),
  joined_date DATE,
  followers INTEGER,
  following INTEGER,
  is_verified BOOLEAN DEFAULT FALSE,
  is_streamer BOOLEAN DEFAULT FALSE,
  last_activity_at BIGINT,                  -- platform epoch (ms or s, kept raw)
  status VARCHAR(20) NOT NULL DEFAULT 'connected',
  last_error TEXT,
  last_synced_at TIMESTAMP,
  data JSONB DEFAULT '{}',                  -- snapshot of the raw profile payload
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_cca_user ON connected_chess_accounts (user_id);

-- Current + best rating per category per account.
CREATE TABLE IF NOT EXISTS chess_ratings (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES connected_chess_accounts(id) ON DELETE CASCADE,
  category VARCHAR(30) NOT NULL,            -- bullet | blitz | rapid | classical | correspondence | puzzle | fide...
  rating INTEGER NOT NULL,
  best INTEGER,
  last_updated_at BIGINT,
  UNIQUE (account_id, category)
);

-- Rating history points (one aggregate point per day, combined across sources).
CREATE TABLE IF NOT EXISTS chess_rating_history (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES connected_chess_accounts(id) ON DELETE CASCADE,
  category VARCHAR(30) NOT NULL,
  point_date DATE NOT NULL,
  rating INTEGER NOT NULL,
  UNIQUE (account_id, category, point_date)
);
CREATE INDEX IF NOT EXISTS idx_chess_rating_history_account ON chess_rating_history (account_id, category, point_date);

-- Imported games from both platforms (deduplicated via unique account+platform game id).
CREATE TABLE IF NOT EXISTS chess_games (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES connected_chess_accounts(id) ON DELETE CASCADE,
  platform_game_id VARCHAR(160),            -- chess.com game url / lichess game id
  game_date DATE,
  end_time_ms BIGINT,
  white_name VARCHAR(120),
  black_name VARCHAR(120),
  white_rating INTEGER,
  black_rating INTEGER,
  result VARCHAR(10) NOT NULL,              -- white | black | draw
  my_color VARCHAR(5),                       -- the account owner's colour
  time_control VARCHAR(20),                 -- e.g. "300+0"
  time_class VARCHAR(30),                   -- bullet | blitz | rapid | classical | correspondence...
  opening TEXT,
  eco VARCHAR(10),
  pgn TEXT,
  game_url TEXT,
  game_event TEXT,
  moves_count INTEGER DEFAULT 0,
  is_rated BOOLEAN DEFAULT FALSE,
  UNIQUE (account_id, platform_game_id)
);
CREATE INDEX IF NOT EXISTS idx_chess_games_account_date ON chess_games (account_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_chess_games_account ON chess_games (account_id);
-- Incremental sync reads MAX(end_time_ms) per account on every poll. Without
-- this the watermark is a full scan of that account's whole history, so poll
-- cost grows with the number of games already stored rather than staying flat.
CREATE INDEX IF NOT EXISTS idx_chess_games_account_end_time ON chess_games (account_id, end_time_ms DESC);

-- guard for tables that already existed before this file added my_color
ALTER TABLE chess_games ADD COLUMN IF NOT EXISTS my_color VARCHAR(5);

-- Audit trail of sync runs (per account).
CREATE TABLE IF NOT EXISTS sync_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES connected_chess_accounts(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,              -- ok | partial | error
  new_games INTEGER DEFAULT 0,
  message TEXT,
  synced_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_history_user ON sync_history (user_id, synced_at DESC);

-- Optional persisted engine analysis for an imported game (computed in-browser
-- with Stockfish and stored here so it survives a refresh / session change).
CREATE TABLE IF NOT EXISTS imported_game_analysis (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES chess_games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (game_id, user_id)
);