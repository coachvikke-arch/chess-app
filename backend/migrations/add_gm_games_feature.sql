-- Feature Access section for the GM Games library.
--
-- Registers the "GM Games" toggle so a Super Admin can decide, per role,
-- whether the historical grandmaster games section is visible and usable.
-- Follows the fail-closed rule from add_feature_permissions.sql: the feature is
-- seeded OFF for both roles until explicitly enabled.
--
-- Safe to re-run: the feature insert is ON CONFLICT DO NOTHING and the switch
-- rows use ON CONFLICT (feature_id, role) DO NOTHING.

INSERT INTO features (key, name, description, category, route, sort_order) VALUES
  ('gm_games', 'GM Games', 'Browse and import historical grandmaster games for study, coaching and classroom analysis.', 'Coach Tools', '/admin/gm-games', 165)
ON CONFLICT (key) DO NOTHING;

-- One switch row per role, so the Feature Access grid shows both columns and a
-- missing row can never be mistaken for "not configured yet".
INSERT INTO role_permissions (feature_id, role, is_enabled)
SELECT f.id, r.role, FALSE
FROM features f
CROSS JOIN (VALUES ('student'), ('coach')) AS r(role)
WHERE f.key = 'gm_games'
ON CONFLICT (feature_id, role) DO NOTHING;
