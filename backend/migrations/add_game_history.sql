-- Game History + permanent per-student analysis + cleanup audit log
-- Run: psql <db> -f backend/migrations/add_game_history.sql

-- Permanent per-student summary of finished online games.
-- Populated by the nightly aggregation/cleanup job BEFORE old rows are deleted,
-- so per-student analysis survives the retention-window deletion.
CREATE TABLE IF NOT EXISTS student_game_analysis (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,          -- start of the aggregated window (e.g. today for daily rollups)
  period_end DATE NOT NULL,            -- end of the aggregated window
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  abandoned INTEGER NOT NULL DEFAULT 0,
  avg_moves REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (student_user_id, period_start)
);

-- Marks that a finished online game has already been aggregated into
-- student_game_analysis (makes aggregation idempotent / re-runnable).
ALTER TABLE online_games ADD COLUMN IF NOT EXISTS analysis_aggregated_at TIMESTAMP;

-- Audit log row per cleanup/aggregation run (safe, auditable deletion).
CREATE TABLE IF NOT EXISTS cleanup_log (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL DEFAULT 'game_history',
  rows_aggregated INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_deleted INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER NOT NULL DEFAULT 7,
  ran_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_games_finished_at ON online_games (updated_at) WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_online_games_unanalyzed ON online_games (id) WHERE status = 'finished' AND analysis_aggregated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cleanup_log_ran_at ON cleanup_log (ran_at DESC);

ALTER TABLE cleanup_log ADD COLUMN IF NOT EXISTS rows_written INTEGER NOT NULL DEFAULT 0;