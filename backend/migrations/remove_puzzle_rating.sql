-- Migration: remove the puzzle rating column (rating is not used by the system)
-- Run: node run_migration_remove_rating.js  (or psql -d chess -f migrations/remove_puzzle_rating.sql)

DROP INDEX IF EXISTS idx_puzzles_rating;
ALTER TABLE puzzles DROP COLUMN IF EXISTS rating;