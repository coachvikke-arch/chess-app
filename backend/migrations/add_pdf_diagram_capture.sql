-- Migration: PDF diagram capture (admin course tools).
-- Run: psql <db> -f backend/migrations/add_pdf_diagram_capture.sql
--
-- Adds the feature switch for POST /api/diagrams/read and the saved_positions
-- table used when a coach keeps a position pulled out of a worksheet.
--
-- Additive only. No existing column is altered, no data is dropped, and no
-- existing feature's row is touched. Both statements are idempotent, matching
-- the convention used by every other migration in this directory
-- (CREATE ... IF NOT EXISTS plus ON CONFLICT DO NOTHING), so re-running is safe.
--
-- Reversal: see remove_pdf_diagram_capture.sql.

/* The feature switch. Seeded DISABLED for both roles, which is the platform
   default for every flag (permissionService resolves a missing/false row to
   "denied"). A Super Admin enables it from the Feature Access panel; the
   frontend picks it up automatically from GET /api/permissions/me.
   NOTE the permission vocabulary here is ('student','coach') — the app role
   'admin' maps to 'coach' at the permission boundary (toPermissionRole). */
INSERT INTO features (key, name, description, category, route, sort_order)
VALUES (
  'pdf_diagram_capture',
  'PDF Diagram Capture',
  'Read a chess diagram from a PDF worksheet into an editable position.',
  'Coach Tools',
  '/admin/courses',
  170
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (feature_id, role, is_enabled)
SELECT f.id, r.role, FALSE
FROM features f
CROSS JOIN (VALUES ('student'), ('coach')) AS r(role)
WHERE f.key = 'pdf_diagram_capture'
ON CONFLICT (feature_id, role) DO NOTHING;

/* Saved positions (§32).
   Stores the POSITION, never the image: §36 says the uploaded crop must not be
   persisted, and keeping the original page around would also mean keeping a
   copy of the coach's copyrighted worksheet. source_file_name / source_page
   record provenance only — a filename and a page number, not content. */
CREATE TABLE IF NOT EXISTS saved_positions (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fen VARCHAR(120) NOT NULL,
  turn CHAR(1) NOT NULL DEFAULT 'w' CHECK (turn IN ('w', 'b')),
  castling VARCHAR(4) NOT NULL DEFAULT '-',
  title VARCHAR(160),
  source_file_name VARCHAR(255),
  source_page INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  /* One row per position is meaningless; blanks are allowed because a coach
     may save a bare board while building a puzzle. */
  CONSTRAINT saved_positions_owner_fen UNIQUE (owner_id, fen)
);

CREATE INDEX IF NOT EXISTS idx_saved_positions_owner ON saved_positions (owner_id, updated_at DESC);

/* Daily recognition quota (§35).
   There is no usage-metering convention anywhere in this codebase, so the cap
   is a small ledger rather than a counter column on users: it is auditable,
   survives concurrent requests, and cannot be inflated by a client. */
CREATE TABLE IF NOT EXISTS diagram_read_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_on DATE NOT NULL DEFAULT CURRENT_DATE,
  reads INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT diagram_read_usage_user_day UNIQUE (user_id, read_on)
);

CREATE INDEX IF NOT EXISTS idx_diagram_read_usage_user ON diagram_read_usage (user_id, read_on DESC);