-- Academy module: levels, lessons, openings and badges.
-- Curriculum content lives in backend/src/data/academyCurriculum.js (levels,
-- lessons, exercises). These tables persist per-user progress + gamification.

CREATE TABLE IF NOT EXISTS academy_stats (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  last_practice_date DATE,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  exercises_attempted INTEGER NOT NULL DEFAULT 0,
  exercises_correct INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per (user, level, lesson, exercise).
CREATE TABLE IF NOT EXISTS academy_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_slug TEXT NOT NULL,
  lesson_slug TEXT NOT NULL,
  exercise_slug TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  total_time_ms INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP,
  last_practiced_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, level_slug, lesson_slug, exercise_slug)
);

CREATE INDEX IF NOT EXISTS idx_academy_progress_user ON academy_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_academy_progress_lesson ON academy_progress (level_slug, lesson_slug);

-- Training sessions (e.g. Beginner Training Mode).
CREATE TABLE IF NOT EXISTS academy_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_kind TEXT NOT NULL,          -- 'beginner-training' | 'opening-practice'
  level_slug TEXT NOT NULL DEFAULT '',
  lesson_slug TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  total_time_ms INTEGER NOT NULL DEFAULT 0,
  abandoned BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_sessions_user ON academy_sessions (user_id);

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

-- Badges (gamification).
CREATE TABLE IF NOT EXISTS academy_badges (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🏆',
  description TEXT NOT NULL DEFAULT '',
  xp_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_academy_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES academy_badges(code) ON DELETE CASCADE,
  unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_code)
);

-- Seed badge definitions (idempotent).
INSERT INTO academy_badges (code, name, icon, description, xp_value) VALUES
  ('first-lesson',    'First Chess Lesson',  '🏆', 'Completed your first chess lesson.', 20),
  ('board-explorer',  'Board Explorer',      '♞', 'Learned the chessboard layout.', 10),
  ('pawn-master',     'Pawn Master',         '♟️', 'Mastered the Pawn lesson.', 25),
  ('knight-master',   'Knight Master',       '🐴', 'Mastered the Knight lesson.', 25),
  ('rook-master',     'Rook Master',         '♜', 'Mastered the Rook lesson.', 25),
  ('bishop-master',   'Bishop Master',       '♝', 'Mastered the Bishop lesson.', 25),
  ('queen-master',    'Queen Master',        '♛', 'Mastered the Queen lesson.', 25),
  ('king-master',     'King Master',         '♚', 'Mastered the King lesson.', 25),
  ('rules-master',    'Rules Master',        '⚖', 'Mastered the special chess rules.', 30),
  ('trained',         'Beginner Trained',    '🔥', 'Finished Beginner Training Mode.', 40),
  ('opening-beginner','Opening Beginner',    '♘', 'Completed your first opening lesson.', 30),
  ('opening-expert',  'Opening Expert',      '🎯', 'Completed every Intermediate opening.', 50),
  ('chess-master',    'Chess Opening Master','🏆', 'Reached Chess Opening Master.', 100)
ON CONFLICT DO NOTHING;