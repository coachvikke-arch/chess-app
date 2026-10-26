-- ═══════════════════════════════════════════════════════════════════════════
-- Shared Chess Library (PGN / FEN folders) — server-backed, shared by ALL
-- admins and the superadmin.
--
-- WHY: the Library used to live in each browser's localStorage
-- ('chess-library-v1'). Every admin had a private, per-machine copy, so a
-- folder one coach added was invisible to every other admin.
--
-- DESIGN RULE (the whole point of this change):
--   The library is GLOBAL. There is no owner column that may be filtered on.
--   `created_by` is an audit/informational field ONLY — recorded on insert,
--   never used in a WHERE clause. Do not add owner scoping to these tables.
--
-- This migration is ADDITIVE and IDEMPOTENT:
--   * creates two new tables (CREATE TABLE IF NOT EXISTS)
--   * creates two indexes (CREATE INDEX IF NOT EXISTS)
--   * touches no existing table and drops nothing
--   * NO destructive operations, no DROP / TRUNCATE / DELETE
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS library_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  -- Self-reference for nesting. ON DELETE CASCADE so deleting a parent folder
  -- removes its whole subtree in the database, not just in the browser.
  parent_id INTEGER REFERENCES library_folders(id) ON DELETE CASCADE,
  type VARCHAR(30) DEFAULT 'general',
  description TEXT,
  -- Explicit ordering: the old localStorage library relied on array order,
  -- which a relational table cannot express.
  position INTEGER NOT NULL DEFAULT 0,
  -- Informational only. NEVER filter on this.
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS library_folders_parent_idx
  ON library_folders (parent_id, position);

CREATE TABLE IF NOT EXISTS library_items (
  id SERIAL PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'pgn' CHECK (type IN ('pgn', 'fen')),
  -- 'pgn' items store a full PGN, 'fen' items a single FEN.
  notation TEXT NOT NULL,
  -- Optional dual-format fields; the viewer falls back to `notation`.
  fen TEXT,
  pgn TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  -- Informational only. NEVER filter on this.
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS library_items_folder_idx
  ON library_items (folder_id, position);

COMMIT;

-- ─── Verify (read-only) ───────────────────────────────────────────────────
-- Expect: two tables present, both created_at defaults = now(), both
-- created_by columns nullable and referencing users(id).
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name IN ('library_folders', 'library_items')
--  ORDER BY table_name, ordinal_position;