-- Reversal for: PDF diagram capture (admin course tools).
-- Run: psql <db> -f backend/migrations/remove_pdf_diagram_capture.sql
--
-- Removes ONLY what add_pdf_diagram_capture.sql created. Written as the inverse
-- so the two files can be read as a pair.
--
-- SAFETY: this drops two tables and deletes one features row. Dropping
-- saved_positions DELETES any positions a coach saved, so run the SELECTs below
-- first if there is anything in it worth keeping. Nothing outside this feature
-- is touched: no other table, column or feature row is referenced.
--
-- This file is NOT run automatically by any script - apply it deliberately.

-- Preview what would be lost. Expect zero rows on a fresh install.
-- SELECT id, owner_id, fen, title, created_at FROM saved_positions ORDER BY created_at DESC;
-- SELECT user_id, read_on, reads FROM diagram_read_usage ORDER BY read_on DESC;

DROP TABLE IF EXISTS diagram_read_usage;
DROP TABLE IF EXISTS saved_positions;

-- role_permissions rows go with it (ON DELETE CASCADE on feature_id), but be
-- explicit so this file does not depend on that constraint existing.
DELETE FROM role_permissions WHERE feature_id IN (SELECT id FROM features WHERE key = 'pdf_diagram_capture');
DELETE FROM features WHERE key = 'pdf_diagram_capture';