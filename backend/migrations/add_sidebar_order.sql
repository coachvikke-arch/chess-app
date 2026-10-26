-- Migration: Super Admin–configurable sidebar order
-- Run: node run_migration.js migrations/add_sidebar_order.sql
--
-- This table stores the ORDER of the nav links, never their membership. The
-- client keeps the authoritative list of links in Sidebar.jsx (admin) and
-- StudentAppShell.jsx (student) and sends their route keys here; the server
-- only remembers a rank per key.
--
-- Storing ranks rather than copying labels/routes into the database is
-- deliberate: a nav item added to the client later has no row here, so it falls
-- back to its position in code instead of vanishing from the menu, and a
-- relabelled item keeps its place without a migration.
--
-- `menu` scopes the key because /openings appears in BOTH the admin and the
-- student menu, so the route alone is not unique across the app.

CREATE TABLE IF NOT EXISTS sidebar_order (
  menu        VARCHAR(20) NOT NULL CHECK (menu IN ('admin', 'student')),
  item_key    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu, item_key)
);

-- The only read pattern is "ranks for one menu, in order".
CREATE INDEX IF NOT EXISTS idx_sidebar_order_menu ON sidebar_order (menu, sort_order);
