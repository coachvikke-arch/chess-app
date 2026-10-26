-- Migration: bot ("Play vs Bots") progression, coins and reward milestones.
-- Run: psql <db> -f backend/migrations/add_bot_progress.sql
--
-- The bot catalogue itself stays on the client (frontend/src/data/bots.ts) so
-- the feature works fully offline. These tables are only the AUTHORITATIVE
-- record for signed-in students, which is what keeps coins and defeat flags
-- from being lost by clearing localStorage or switching devices.
--
-- Distinct from `computer_games` (add_computer_games.sql), which stores game
-- history/PGNs, and from `academy_reward_unlocks`, which is single-reward.
-- This one is a per-bot progression ledger with a game-id dedupe table.

-- One row per (student, bot).
CREATE TABLE IF NOT EXISTS bot_progress (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id VARCHAR(64) NOT NULL,
  -- 'Beginner' | 'Casual' | 'Intermediate' | 'Advanced' | 'Expert' | 'Master'
  difficulty VARCHAR(20) NOT NULL,
  -- True once the student has beaten this bot at least once.
  defeated BOOLEAN NOT NULL DEFAULT false,
  games_won INTEGER NOT NULL DEFAULT 0,
  games_lost INTEGER NOT NULL DEFAULT 0,
  games_drawn INTEGER NOT NULL DEFAULT 0,
  -- Best recorded engine accuracy (0-100), when the client graded the game.
  best_accuracy SMALLINT,
  last_played_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_progress_unique_student_bot UNIQUE (student_user_id, bot_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_progress_student ON bot_progress (student_user_id);

-- Coin balance and claimed milestones. One row per student, mirroring how
-- `academy_reward_unlocks` scopes a reward to a student.
CREATE TABLE IF NOT EXISTS bot_rewards (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Milestone coin awards: 25 / 50 / 75 / 100 / 125. The unique constraint makes
-- a double-submitted game or a concurrent request harmless (same pattern as
-- academy_reward_unlocks).
CREATE TABLE IF NOT EXISTS bot_reward_unlocks (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_coins INTEGER NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_reward_unlock_unique UNIQUE (student_user_id, milestone_coins)
);

-- Idempotency ledger. A replayed or double-submitted result is recognised by
-- its game id and credited zero further coins.
CREATE TABLE IF NOT EXISTS bot_game_results (
  id SERIAL PRIMARY KEY,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id VARCHAR(64) NOT NULL,
  bot_id VARCHAR(64) NOT NULL,
  result VARCHAR(8) NOT NULL,
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  accuracy SMALLINT,
  plies INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_game_result_unique_game UNIQUE (student_user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_game_results_student ON bot_game_results (student_user_id);