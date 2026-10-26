-- Migration: audit log for puzzle CSV imports + index for dup detection
-- Run: node run_migration_csv.js  (or psql -d chess -f migrations/add_puzzle_imports.sql)

CREATE TABLE IF NOT EXISTS puzzle_imports (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  file_name VARCHAR(255),
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  errors_detail JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puzzle_imports_admin ON puzzle_imports (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_imports_created ON puzzle_imports (created_at DESC);

-- Speeds up duplicate detection by FEN during imports (fetch existing rows
-- for a whole batch with one WHERE fen = ANY(...) lookup).
CREATE INDEX IF NOT EXISTS idx_puzzles_fen ON puzzles (fen);