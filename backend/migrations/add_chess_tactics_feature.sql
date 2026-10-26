-- Feature Access section for Chess Tactics.
--
-- Registers the "Chess Tactics" toggle so a Super Admin can decide, per role,
-- whether the 45-tactic learning section is visible and usable.
--
-- Seeded ON for both roles, which is a deliberate exception to the fail-closed
-- rule in add_feature_permissions.sql: Tactics already exists and is visible to
-- every coach and student, so registering it OFF would silently revoke a
-- section people already use. The Super Admin can still switch either role
-- off afterwards.
--
-- Safe to re-run: the feature insert is ON CONFLICT DO NOTHING and the switch
-- rows use ON CONFLICT (feature_id, role) DO NOTHING, so a re-run never flips
-- a switch the Super Admin has since changed.

INSERT INTO features (key, name, description, category, route, sort_order) VALUES
  ('chess_tactics', 'Chess Tactics', 'The 45-tactic visual learning section: positions, arrows and explanations.', 'Coach Tools', '/admin/tactics', 166)
ON CONFLICT (key) DO NOTHING;

-- One switch row per role, so the Feature Access grid shows both columns and a
-- missing row can never be mistaken for "not configured yet".
INSERT INTO role_permissions (feature_id, role, is_enabled)
SELECT f.id, r.role, TRUE
FROM features f
CROSS JOIN (VALUES ('student'), ('coach')) AS r(role)
WHERE f.key = 'chess_tactics'
ON CONFLICT (feature_id, role) DO NOTHING;
