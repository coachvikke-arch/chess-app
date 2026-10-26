-- Migration: audit log for PDF puzzle imports (crop → detect → review → save).
-- Run: node run_migration_pdf_imports.js  (or psql -d chess -f migrations/add_pdf_puzzle_imports.sql)
--
-- The CSV import audit lives in the existing `puzzle_imports` table; this is a
-- separate log for the PDF flow so each source keeps its own columns (the PDF
-- flow records page/diagram counts and the destination set/folder).

CREATE TABLE IF NOT EXISTS pdf_puzzle_imports (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pdf_name VARCHAR(255),
  page_count INTEGER NOT NULL DEFAULT 0,
  diagram_count INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  set_code VARCHAR(32),
  folder_id INTEGER REFERENCES set_folders(id) ON DELETE SET NULL,
  details JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_puzzle_imports_admin ON pdf_puzzle_imports (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_puzzle_imports_created ON pdf_puzzle_imports (created_at DESC);