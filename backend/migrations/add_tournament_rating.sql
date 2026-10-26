-- Tournament games join the existing rating system.
--
-- WHY a separate migration: the rating tables are created by
-- add_rating_system.sql, not by schema.sql, and this migration assumes the
-- rating subsystem is installed. It is additive and idempotent, so it can be
-- re-run safely.
--
-- Run: psql <db> -f backend/migrations/add_tournament_rating.sql
-- (or: node backend/run_migration_tournament_rating.js)

-- ── 1. tournament_games: settlement state ────────────────────────────────
-- rating_status tells us whether a finished game has been settled, was
-- deliberately not rated, or had its settlement reversed by an admin.
--   pending   game finished, settlement not attempted yet (or in flight)
--   applied   ratings moved, exactly once
--   skipped   result is not rateable (armageddon, abandon, no student row)
--   reverted  an applied settlement was reversed by an admin correction
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_status VARCHAR(16) NOT NULL DEFAULT 'pending';
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_result VARCHAR(16);
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_note TEXT;
CREATE INDEX IF NOT EXISTS idx_tournament_games_rating_status ON tournament_games (rating_status);

-- ── 2. rating_history: link each row to the tournament game ──────────────
-- The UNIQUE index is the database-level exactly-once guarantee: a second
-- settlement of the same game cannot insert a second row for the same player,
-- so the whole rating transaction (rating + history) rolls back instead of
-- applying a duplicate change.
ALTER TABLE rating_history
  ADD COLUMN IF NOT EXISTS tournament_game_id INTEGER REFERENCES tournament_games(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_history_tournament_game
  ON rating_history (tournament_game_id, student_id)
  WHERE tournament_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rating_history_tournament_student
  ON rating_history (student_id, tournament_game_id);

-- ── 3. per-time-control history, same link and guarantee ─────────────────
ALTER TABLE time_control_rating_history
  ADD COLUMN IF NOT EXISTS tournament_game_id INTEGER REFERENCES tournament_games(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tc_rating_history_tournament_game
  ON time_control_rating_history (tournament_game_id, student_id)
  WHERE tournament_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_rating_history_tournament_student
  ON time_control_rating_history (student_id, tournament_game_id);
