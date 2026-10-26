-- Super Admin feature access control.
--
-- A registry of every toggleable section, the per-role switches, optional
-- per-user overrides, and an append-only audit trail.
--
-- Role note: this app's user roles are 'superadmin' | 'admin' | 'student';
-- coaches are 'admin'. The permission tables deliberately use the spec's
-- 'student' | 'coach' vocabulary, and PermissionService maps admin <-> coach
-- at the boundary. Super Admin is deliberately absent from this system — it is
-- never gated, so a Super Admin can always recover access to this panel.

CREATE TABLE IF NOT EXISTS features (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  -- Optional client-side hint so a new feature can be linked to a route
  -- without a code change to the registry.
  route TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_category ON features (category);

-- One row per (feature, role). Absence of a row means DISABLED (fail-closed).
CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'coach')),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (feature_id, role)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions (role);

-- Per-user exceptions that win over the role default.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_user_overrides_user ON user_permission_overrides (user_id);

-- Append-only audit trail: who changed what, when, and at which scope.
CREATE TABLE IF NOT EXISTS feature_permission_audit (
  id SERIAL PRIMARY KEY,
  feature_id INTEGER REFERENCES features(id) ON DELETE SET NULL,
  feature_key TEXT NOT NULL,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('role', 'user', 'bulk')),
  role VARCHAR(20),
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  old_value BOOLEAN,
  new_value BOOLEAN,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_audit_created ON feature_permission_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_audit_feature ON feature_permission_audit (feature_id);

-- ---------------------------------------------------------------------------
-- Seed the registry. ON CONFLICT DO NOTHING keeps re-running the migration
-- from clobbering whatever the Super Admin has since configured.
-- ---------------------------------------------------------------------------
INSERT INTO features (key, name, description, category, route, sort_order) VALUES
  ('piece_lessons',     'Piece Lessons',       'Structured piece-by-piece courses and guided lessons.',     'Student Tools', '/student/openings',       10),
  ('live_game',         'Live Game',           'Play rated games online against other members.',             'Student Tools', '/student/online',          20),
  ('puzzle_trainer',    'Puzzle Trainer',      'Tactics puzzle sets with hints and streaks.',               'Student Tools', '/student/puzzles',         30),
  ('progress_tracker',  'Progress Tracker',    'Ratings, streaks and activity history.',                     'Student Tools', '/student/progress',       40),
  ('leaderboard',       'Leaderboard',         'Academy-wide rating ladder and rankings.',                   'Student Tools', '/student/leaderboard',    50),
  ('game_analysis',     'Game Analysis',       'Upload and review your own games with engine feedback.',     'Student Tools', '/student/game-analysis',  60),
  ('assignments',       'Assignments',         'Lesson and puzzle homework set by your coach.',              'Student Tools', '/student/assignments',    70),
  ('tournaments',       'Tournaments',         'Academy tournaments with brackets and standings.',           'Student Tools', '/student/tournaments',    80),
  ('opening_library',   'Opening Library',     'Study 40 classical openings move by move, then practise.',   'Student Tools', '/openings',                90),
  ('messaging_coach',   'Messaging Coach',     'Direct messages to your coach.',                             'Student Tools', '/student/people',         100),
  ('student_roster',    'Student Roster',      'Browse, filter and manage your students.',                   'Coach Tools',   '/admin/students',         110),
  ('assign_lessons',    'Assign Lessons',      'Create and grade lesson and puzzle assignments.',            'Coach Tools',   '/admin/assignments',      120),
  ('live_review',       'Live Game Review',    'Review submitted games and run live classroom sessions.',     'Coach Tools',   '/admin/review',           130),
  ('analytics',         'Analytics Dashboard', 'Cohort performance, engagement and progress reporting.',    'Coach Tools',   '/admin/dashboard',        140),
  ('messaging_students','Messaging Students',  'Broadcast and direct messages to students.',                 'Coach Tools',   '/admin/announcements',    150),
  ('puzzle_authoring',  'Puzzle Authoring',    'Create and import puzzle sets and manage ratings.',          'Coach Tools',   '/admin/puzzle-listing',   160),
  ('profile_settings',  'Profile Settings',    'Name, avatar, board theme and piece set.',                   'General',       '/student/settings',       170),
  ('notifications',     'Notifications',       'In-app alerts, match requests and announcements.',            'General',       NULL,                      180)
ON CONFLICT (key) DO NOTHING;

-- A switch row for every (feature, role) pair, so the admin grid is dense and
-- a missing row can never be mistaken for "not configured yet".
--
-- Everything starts OFF. This is the fail-closed rule: a feature stays invisible
-- until a Super Admin explicitly enables it for a role. There is deliberately
-- NO "baseline on" block here — restoring one would silently re-open every
-- feature the next time this migration is re-run.
INSERT INTO role_permissions (feature_id, role, is_enabled)
SELECT f.id, r.role, FALSE
FROM features f
CROSS JOIN (VALUES ('student'), ('coach')) AS r(role)
ON CONFLICT (feature_id, role) DO NOTHING;
