-- Migration: persistent, editable puzzle sets (merged "numbered variant" sets)
-- Run: node run_migration_sets.js  (or psql -d chess -f migrations/add_sets_merge.sql)
--
-- Adds a `sets` table and a `puzzles.set_code` column. The companion runner
-- (run_migration_sets.js) then merges the former "<Type> (<Level>)" variant
-- sets into one combined set per theme type (e.g. "Endgame (1)", "(2)", "(3)"
-- all become the single "Endgame" set) and backfills every puzzle.
--
-- Data safety: additive only. No puzzles are deleted or truncated; each puzzle
-- keeps its id, so existing attempts/assignments remain valid. Sets are never
-- deleted and puzzle set-codes are only ever written where missing, so an
-- admin rename after this migration is never overwritten.

CREATE TABLE IF NOT EXISTS sets (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  type_tag VARCHAR(40) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS set_code VARCHAR(32);

-- Speeds up per-set browsing/counting in the admin library.
CREATE INDEX IF NOT EXISTS idx_puzzles_set_code ON puzzles (set_code);

-- Speeds up per-set sequential numbering/listing (ROW_NUMBER PARTITION BY
-- set_code ORDER BY id) and paginated across-set scans grouped by set.
CREATE INDEX IF NOT EXISTS idx_puzzles_set_code_id ON puzzles (set_code, id);