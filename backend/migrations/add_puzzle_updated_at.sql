-- Migration: cheap "has this puzzle set changed?" signal for ETag/304 handling
-- Run: node run_migration_puzzle_updated_at.js  (or psql -d chess -f migrations/add_puzzle_updated_at.sql)
--
-- listSetPuzzles currently rebuilds the whole set (DB read + per-puzzle
-- chess.js replay) on EVERY request, including revalidations that end in a
-- 304. This migration adds puzzles.updated_at + an auto-bump trigger so the
-- server can answer "did anything change?" with one ~0ms index query instead
-- of doing all the expensive work first and only then deciding it was pointless.
--
-- Data safety: additive only. Existing rows get NOW() as their baseline
-- updated_at (equivalent to "as of migration time"), so nothing is altered and
-- the first request after migration is simply treated as changed.

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Auto-touch updated_at on any column mutation (inserts already default to NOW()).
CREATE OR REPLACE FUNCTION touch_puzzle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_puzzles_touch_updated_at ON puzzles;
CREATE TRIGGER trg_puzzles_touch_updated_at
  BEFORE UPDATE ON puzzles
  FOR EACH ROW EXECUTE FUNCTION touch_puzzle_updated_at();

-- Cover the per-set has-changed check: WHERE set_code = $1 ORDER/MAX(updated_at).
CREATE INDEX IF NOT EXISTS idx_puzzles_set_code_updated_at
  ON puzzles (set_code, updated_at);