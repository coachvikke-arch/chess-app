-- Migration: tag online_games rows with the live class they came from.
-- Run: node run_migration_pvp.js  (or psql -d chess -f migrations/add_online_class_id.sql)
--
-- Instructor-started "Player vs Player" classroom games get a class_id so the
-- live classroom (and its spectator grid) can list exactly that class's games.
-- Additive only: NULL class_id keeps every pre-existing match unaffected.

ALTER TABLE online_games ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_online_games_class_status ON online_games (class_id, status);