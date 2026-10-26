-- Migration: retire the progress_tracker feature (the My Progress page is gone)
-- Run: node run_migration_remove_progress_tracker.js  (or psql -d chess -f migrations/remove_progress_tracker_feature.sql)
--
-- /student/progress has been deleted, so the `progress_tracker` switch had nothing
-- behind it: it appeared in Feature Access, could be turned On, and then granted
-- no page at all. Leaving it would be the same class of problem as the PDF import
-- button - a control that reads as meaningful and does nothing.
--
-- Deleting the registry row is safe for the audit trail by design:
--   · feature_permission_audit.feature_id is ON DELETE SET NULL, but the row also
--     stores feature_key TEXT NOT NULL, so past changes keep their wording.
--   · role_permissions.feature_id and user_feature_permission_overrides.feature_id
--     are ON DELETE CASCADE, which is the intent - the switches go with the page.
--   · role_permissions rows are also filtered by role, so only the student rows
--     are removed; any coach row for this key is deleted deliberately below.
--
-- Reversible: re-insert the row and re-grant the student role default.
--   INSERT INTO features (key, name, description, category, route, sort_order)
--   VALUES ('progress_tracker', 'Progress Tracker', 'Ratings, streaks and activity history.',
--           'Student Tools', '/student/progress', 40);

DELETE FROM role_permissions
WHERE feature_id = (SELECT id FROM features WHERE key = 'progress_tracker');

DELETE FROM features WHERE key = 'progress_tracker';