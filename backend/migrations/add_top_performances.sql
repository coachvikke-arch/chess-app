-- Migration: Top Performances showcase
-- Run: node run_migration.js migrations/add_top_performances.sql
--
-- Coaches and the Super Admin upload a photo plus details celebrating a
-- student achievement (tournament win, prize, milestone). Visibility is
-- decided at read time, never stored per viewer:
--   - items created by the Super Admin are visible to EVERY student;
--   - items created by a coach are visible ONLY to that coach's allocated
--     students (primary coach_id or a student_coaches row).
-- Deleting the author's account orphans their items (created_by -> NULL),
-- which drops them from every list rather than showing authorless posts.

CREATE TABLE IF NOT EXISTS top_performances (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_top_performances_created
  ON top_performances (created_by, created_at DESC);
