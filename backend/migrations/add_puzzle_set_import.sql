-- Migration: CSV bulk puzzle import into a single titled set.
-- Run: psql -d chess -f migrations/add_puzzle_set_import.sql
--
-- Adds optional per-puzzle columns used by the "Import CSV into a Set" feature.
-- Existing puzzles are left untouched (NULLs), so nothing already stored changes.
-- Drops nothing; safe to re-run.

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS title VARCHAR(200);
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS order_index INT;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS rating INT;

-- Preserve CSV row order within a set while keeping fastest-by-insert fallback.
CREATE INDEX IF NOT EXISTS idx_puzzles_set_code_order_index
  ON puzzles (set_code, order_index NULLS LAST, id);