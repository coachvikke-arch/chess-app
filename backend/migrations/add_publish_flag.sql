-- Migration: add publish/visibility control for puzzles
-- Run: psql -d chess -f migrations/add_publish_flag.sql
-- (or via the db:init / migration runner)

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_puzzles_published ON puzzles (is_published);
