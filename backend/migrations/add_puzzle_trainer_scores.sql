-- Migration: points and ladder for the rating-level Puzzle Trainer.
-- Run: node run_migration.js migrations/add_puzzle_trainer_scores.sql
--
-- The service that owns these tables (src/services/puzzleTrainerScore.js) also
-- installs them on first use, so a database that never ran this file still
-- serves the trainer. This is the same DDL, kept for the record.

CREATE TABLE IF NOT EXISTS puzzle_trainer_scores (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(150) NOT NULL DEFAULT '',
  total_points INTEGER NOT NULL DEFAULT 0,
  solved_count INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (user, puzzle): the composite key is what makes a replayed solve
-- answer "already credited" instead of awarding the points twice.
CREATE TABLE IF NOT EXISTS puzzle_trainer_solves (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id VARCHAR(20) NOT NULL,
  points    INTEGER NOT NULL DEFAULT 0,
  first_try BOOLEAN NOT NULL DEFAULT FALSE,
  solve_ms  INTEGER,
  level     SMALLINT,
  solved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS puzzle_trainer_scores_ladder_idx
  ON puzzle_trainer_scores (total_points DESC, solved_count DESC);

CREATE INDEX IF NOT EXISTS puzzle_trainer_solves_user_idx
  ON puzzle_trainer_solves (user_id, solved_at DESC);