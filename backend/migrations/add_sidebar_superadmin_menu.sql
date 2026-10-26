-- Migration: Super Admin menu in the sidebar order panel
-- Run: node run_migration.js migrations/add_sidebar_superadmin_menu.sql
--
-- The reorder panel gains a third tab for the Super Admin's owner-only entries
-- (superAdminLinks in Sidebar.jsx: Certificates, Certificate Settings). Those
-- ranks are stored in the same table, scoped by `menu`, so the CHECK constraint
-- has to admit the new menu value alongside 'admin' and 'student'.

ALTER TABLE sidebar_order DROP CONSTRAINT IF EXISTS sidebar_order_menu_check;
ALTER TABLE sidebar_order
  ADD CONSTRAINT sidebar_order_menu_check CHECK (menu IN ('admin', 'student', 'superadmin'));
