-- Migration: nested folder system for puzzle sets
-- Run: node run_migration_folders.js  (or psql -d chess -f migrations/add_set_folders.sql)
--
-- Adds a self-referencing `set_folders` table (unlimited nesting depth)
-- and links existing `sets` to folders via a nullable `folder_id` column.

CREATE TABLE IF NOT EXISTS set_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  parent_folder_id INTEGER REFERENCES set_folders(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Fast child-folder lookups: "all children of folder X in the same course scope"
-- Since set_folders is global (not per-course), parent_folder_id alone is enough.
CREATE INDEX IF NOT EXISTS idx_set_folders_parent ON set_folders (parent_folder_id);

-- Fast sort-order queries among siblings
CREATE INDEX IF NOT EXISTS idx_set_folders_parent_sort ON set_folders (parent_folder_id, sort_order);

-- Link sets to folders (nullable — null = top-level/unfiled)
ALTER TABLE sets ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES set_folders(id) ON DELETE SET NULL;

-- Fast per-folder set lookups
CREATE INDEX IF NOT EXISTS idx_sets_folder_id ON sets (folder_id);
