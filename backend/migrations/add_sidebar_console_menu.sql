-- Migration: console sections in the sidebar order panel
-- Run: node run_migration.js migrations/add_sidebar_console_menu.sql
--
-- The Sidebar Order panel gains a "Console sections" tab that orders the Super
-- Admin console's own tabs (Register account, Passwords, Feature Access,
-- Sidebar Order, Coach Reports). Section keys are stored in the same rank
-- table, scoped by `menu`, so the CHECK constraint has to admit the new value
-- alongside the sidebar menus.

ALTER TABLE sidebar_order DROP CONSTRAINT IF EXISTS sidebar_order_menu_check;
ALTER TABLE sidebar_order
  ADD CONSTRAINT sidebar_order_menu_check CHECK (menu IN ('admin', 'student', 'superadmin', 'console'));
