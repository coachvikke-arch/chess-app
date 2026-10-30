-- Chess Coaching & Learning Platform - PostgreSQL schema
-- Database name: chess

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(30),           -- combined E.164, e.g. +919876543210
  country_code VARCHAR(8),     -- chosen dial code, e.g. +91
  role VARCHAR(20) NOT NULL DEFAULT 'student', -- 'superadmin' | 'admin' | 'student' | 'parent'
  profile_image TEXT,
  avatar_config JSONB,
  board_theme VARCHAR(30) DEFAULT 'classic-green',
  piece_set VARCHAR(30) DEFAULT 'cburnett',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Idempotent upgrades for already-initialized databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_config JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code VARCHAR(8);

-- Concurrent-device session cap. One row per sign-in; the JWT carries its id as
-- `session_id`. A user may hold at most 2 active rows — a third sign-in revokes
-- the oldest, and the auth middleware then rejects that token (SESSION_REVOKED).
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(128),
  device_name VARCHAR(150),
  platform VARCHAR(60),
  refresh_token_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions (user_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_device
  ON user_sessions (user_id, device_id, revoked_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_active_device
  ON user_sessions (user_id, device_id)
  WHERE revoked_at IS NULL AND device_id IS NOT NULL;

-- Backfill a deterministic default avatar for existing students who have
-- never customized one (seeded by their student record id).
UPDATE users u SET avatar_config = jsonb_build_object(
  'seed', 'student_' || s.id,
  'eyes', 'wink',
  'mouth', 'lilSmile',
  'backgroundColor', '71cf62'
)
FROM students s
WHERE s.user_id = u.id AND u.avatar_config IS NULL;

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hide_from_leaderboard BOOLEAN DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  level VARCHAR(30) DEFAULT 'Beginner',
  thumbnail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  order_number INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  video_url TEXT,
  content TEXT,
  fen VARCHAR(100),
  pgn TEXT,
  order_number INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_completion (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT TRUE,
  completed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(lesson_id, student_id)
);

-- ═══ SHARED CHESS LIBRARY (PGN / FEN folders) ═══
-- One library for EVERY admin and the superadmin. There is deliberately NO
-- owner scoping: `created_by` records who added a row and is informational
-- only — it must never appear in a WHERE clause, and no query may filter by
-- it. Replacing the old per-browser localStorage library means a folder one
-- coach adds is immediately visible to all the others.
CREATE TABLE IF NOT EXISTS library_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  -- Self-reference for nesting. ON DELETE CASCADE so deleting a parent folder
  -- removes its whole subtree in the database, not just in the browser.
  parent_id INTEGER REFERENCES library_folders(id) ON DELETE CASCADE,
  type VARCHAR(30) DEFAULT 'general',
  description TEXT,
  -- Explicit ordering: the old localStorage library relied on array order,
  -- which a relational table cannot express.
  position INTEGER NOT NULL DEFAULT 0,
  -- Informational only. NEVER filter on this.
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS library_folders_parent_idx ON library_folders (parent_id, position);

CREATE TABLE IF NOT EXISTS library_items (
  id SERIAL PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'pgn' CHECK (type IN ('pgn', 'fen')),
  -- 'pgn' items store a full PGN, 'fen' items a single FEN.
  notation TEXT NOT NULL,
  -- Optional dual-format fields; the viewer falls back to `notation`.
  fen TEXT,
  pgn TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  -- Informational only. NEVER filter on this.
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS library_items_folder_idx ON library_items (folder_id, position);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  topic VARCHAR(150),
  class_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  meeting_url TEXT,
  material_url TEXT,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | live | completed | cancelled
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  class_type VARCHAR(10) NOT NULL DEFAULT 'external', -- integrated | external
  thumbnail TEXT,
  chat_mode VARCHAR(20) NOT NULL DEFAULT 'open', -- open | instructor-only
  student_interaction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  classroom_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  student_move_side VARCHAR(6) NOT NULL DEFAULT 'both' -- both | white | black
);

CREATE TABLE IF NOT EXISTS live_class_move_grants (
  live_class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  move_side VARCHAR(6) NOT NULL DEFAULT 'both', -- white | black | both
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (live_class_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'absent', -- present | absent | late
  attendance_date DATE,                -- copied from classes.class_date at mark time
  type VARCHAR(20) NOT NULL DEFAULT 'offline', -- offline (register) | online (join)
  marked_by INTEGER,                   -- user id of the admin/superadmin who marked it
  marked_by_name VARCHAR(150),         -- their display name, frozen at mark time
  marked_by_role VARCHAR(20),          -- admin | superadmin
  marked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(class_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
    ON attendance (student_id, attendance_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_offline_student_date
    ON attendance (student_id, attendance_date)
    WHERE class_id IS NULL AND type = 'offline';

-- Direct student membership for a class (replaces group-only assignment in the
-- Schedule Class form). A class is visible to its explicit class_students; if a
-- class has none, legacy group_id / no-group visibility is used instead.
CREATE TABLE IF NOT EXISTS class_students (
  id SERIAL PRIMARY KEY,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(class_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students (class_id);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students (student_id);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
  due_date DATE,
  difficulty VARCHAR(20) DEFAULT 'Medium',
  fen VARCHAR(100),
  pgn TEXT,
  questions JSONB DEFAULT '[]',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  answer TEXT,
  file_url TEXT,
  pgn TEXT,
  score INTEGER,
  feedback TEXT,
  approved BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS daily_tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  task_type VARCHAR(50),
  task_date DATE NOT NULL,
  difficulty VARCHAR(20) DEFAULT 'Medium',
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_completion (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES daily_tasks(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT TRUE,
  completed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, student_id)
);

CREATE TABLE IF NOT EXISTS puzzles (
  id SERIAL PRIMARY KEY,
  fen VARCHAR(120) NOT NULL,
  solution JSONB NOT NULL, -- array of moves in SAN or UCI
  theme VARCHAR(50),
  themes TEXT[] DEFAULT '{}',
  difficulty VARCHAR(20) DEFAULT 'Medium',
  explanation TEXT,
  lichess_id VARCHAR(20) UNIQUE,
  nb_plays INTEGER DEFAULT 0,
  popularity INTEGER DEFAULT 0,
  game_url TEXT,
  opening_tags TEXT[] DEFAULT '{}',
  is_published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puzzles_themes ON puzzles USING GIN (themes);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id SERIAL PRIMARY KEY,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  result VARCHAR(20), -- correct | incorrect
  score INTEGER DEFAULT 0,
  time_taken INTEGER,
  attempted_at TIMESTAMP DEFAULT NOW(),
  attempt_no INTEGER,
  assignment_id INTEGER,
  points_earned INTEGER,
  notes TEXT,
  played_moves TEXT[] DEFAULT '{}'
);

-- Puzzle visibility: which students may see a puzzle. student_id NULL = all students.
CREATE TABLE IF NOT EXISTS puzzle_assignments (
  id SERIAL PRIMARY KEY,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (puzzle_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_puzzle_assignments_puzzle ON puzzle_assignments (puzzle_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_assignments_student ON puzzle_assignments (student_id);

CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_type VARCHAR(30) DEFAULT 'multiple_choice',
  fen VARCHAR(120),
  options JSONB DEFAULT '[]',
  correct_answer TEXT NOT NULL,
  explanation TEXT
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  completed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_analysis (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  pgn TEXT,
  fen VARCHAR(120),
  coach_feedback TEXT,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(150),
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  type VARCHAR(30),
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  related_id INTEGER,
  request_status VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS student_achievements (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
  awarded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, achievement_id)
);

-- Seed a few default achievements
INSERT INTO achievements (name, description, icon) VALUES
  ('First Lesson', 'Completed your first lesson', 'book'),
  ('First Assignment', 'Submitted your first assignment', 'pencil'),
  ('Puzzle Master', 'Solved 50 puzzles correctly', 'puzzle'),
  ('7-Day Streak', 'Completed daily tasks 7 days in a row', 'flame'),
  ('30-Day Streak', 'Completed daily tasks 30 days in a row', 'flame'),
  ('100 Puzzles Solved', 'Solved 100 puzzles', 'trophy'),
  ('Perfect Quiz', 'Scored 100% on a quiz', 'star'),
  ('Course Completed', 'Completed a full course', 'medal'),
  ('Tactics Master', 'Mastered tactical puzzle themes', 'sword'),
  ('Endgame Expert', 'Excelled at endgame puzzles', 'king')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS academy_reward_unlocks (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level_slug TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, reward_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_reward_unlocks_student
  ON academy_reward_unlocks (student_id, unlocked_at DESC);

-- AI Chess Coach — conversation sessions + persisted progress per user.
CREATE TABLE IF NOT EXISTS ai_coach_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'New coach session',
  mode TEXT NOT NULL DEFAULT 'coach',  -- coach | analysis | game | tactics | openings | endgames | plan
  messages JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_coach_sessions_user ON ai_coach_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_coach_progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_active TIMESTAMP,
  stats JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Online (coach vs student) live matches
CREATE TABLE IF NOT EXISTS online_games (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- creator
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- opponent
  admin_color VARCHAR(5) NOT NULL DEFAULT 'white', -- 'white' | 'black' (creator's color)
  fen VARCHAR(120) NOT NULL,
  pgn TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | active | finished | aborted
  result VARCHAR(20), -- 'white' | 'black' | 'draw' | 'abandoned'
  result_reason VARCHAR(20), -- 'checkmate' | 'resignation' | 'timeout' | 'stalemate' | 'repetition' | 'insufficient' | 'agreement'
  time_base_minutes INTEGER NOT NULL DEFAULT 5,
  time_increment_seconds INTEGER NOT NULL DEFAULT 0,
  white_ms BIGINT NOT NULL DEFAULT 300000,
  black_ms BIGINT NOT NULL DEFAULT 300000,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  bot_level INTEGER,
  bot_color VARCHAR(5),
  last_react_emoji VARCHAR(40),
  last_react_by INTEGER,
  last_react_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Live-class puzzle drills: an instructor-run puzzle exercise inside a live
-- classroom. One active drill per class at a time (starting a new one ends the
-- previous). Config mirrors the "Assign to Students" settings.
CREATE TABLE IF NOT EXISTS live_class_puzzle_drills (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | ended
  time_limit_seconds INTEGER,
  points INTEGER NOT NULL DEFAULT 10,
  negative_points INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_drill_class ON live_class_puzzle_drills (live_class_id, status);

-- Inline "Ask quiz" drills started from a course file: when puzzle_id is NULL,
-- the drill runs from the position/solution stored here instead of a library
-- puzzle row.
ALTER TABLE live_class_puzzle_drills ADD COLUMN IF NOT EXISTS puzzle_title TEXT;
ALTER TABLE live_class_puzzle_drills ADD COLUMN IF NOT EXISTS puzzle_fen TEXT;
ALTER TABLE live_class_puzzle_drills ADD COLUMN IF NOT EXISTS puzzle_solution JSONB;
-- "None" attempts = unlimited retries (user picks no limit).
ALTER TABLE live_class_puzzle_drills ALTER COLUMN max_attempts DROP NOT NULL;

-- Per-user live solving progress inside a drill (one row per user, upserted as
-- they solve). `moves` is the current correct line (SOLVING SANs) so the
-- instructor board always renders the latest sequence without duplicates.
CREATE TABLE IF NOT EXISTS live_class_puzzle_progress (
  id SERIAL PRIMARY KEY,
  drill_id INTEGER REFERENCES live_class_puzzle_drills(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  result VARCHAR(20) NOT NULL DEFAULT 'solving', -- solving | completed | failed | time_finished
  moves JSONB DEFAULT '[]',
  attempted INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  solved_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (drill_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_live_drill_progress_drill ON live_class_puzzle_progress (drill_id);
-- Track each wrong move attempt for display in the leaderboard card.
ALTER TABLE live_class_puzzle_progress ADD COLUMN IF NOT EXISTS wrong_moves JSONB DEFAULT '[]';

-- Admin-imported GM master games (bulk PGN import). Runtime store next to the
-- build-time seeded games in frontend/src/games/*.json — the admin catalog
-- merges both, and GameReplay fetches an imported game by id when it is not in
-- the static bundle.
CREATE TABLE IF NOT EXISTS gm_games (
  id VARCHAR(80) PRIMARY KEY,
  white VARCHAR(150) NOT NULL,
  black VARCHAR(150) NOT NULL,
  event VARCHAR(255) NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  result VARCHAR(10) NOT NULL DEFAULT '*',
  pgn TEXT NOT NULL,
  annotations JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  player VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE gm_games ADD COLUMN IF NOT EXISTS player VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_gm_games_year ON gm_games (year DESC);
CREATE INDEX IF NOT EXISTS idx_gm_games_player ON gm_games (player);

-- Super Admin–configurable sidebar order. Ranks only, keyed by the client-side
-- route; see migrations/add_sidebar_order.sql for the rationale.
CREATE TABLE IF NOT EXISTS sidebar_order (
  menu        VARCHAR(20) NOT NULL CHECK (menu IN ('admin', 'student')),
  item_key    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu, item_key)
);
CREATE INDEX IF NOT EXISTS idx_sidebar_order_menu ON sidebar_order (menu, sort_order);
