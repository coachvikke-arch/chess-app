-- Migration: add lichess puzzle support
-- Run: psql -d chess -f migrations/add_lichess_puzzles.sql

-- Add lichess metadata columns to puzzles table
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS lichess_id VARCHAR(20) UNIQUE;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS themes TEXT[] DEFAULT '{}';
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS nb_plays INTEGER DEFAULT 0;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS popularity INTEGER DEFAULT 0;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS game_url TEXT;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS opening_tags TEXT[] DEFAULT '{}';

-- Index for fast theme filtering
CREATE INDEX IF NOT EXISTS idx_puzzles_themes ON puzzles USING GIN (themes);
CREATE INDEX IF NOT EXISTS idx_puzzles_lichess_id ON puzzles (lichess_id);