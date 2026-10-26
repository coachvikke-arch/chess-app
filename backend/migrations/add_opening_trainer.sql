-- Opening Trainer: courses, training lines, progress, likes/reports, community poll.

CREATE TABLE IF NOT EXISTS opening_courses (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  side VARCHAR(5) NOT NULL DEFAULT 'white' CHECK (side IN ('white', 'black')),
  description TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  difficulty VARCHAR(12) NOT NULL DEFAULT 'Easy' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  eco_code VARCHAR(3),
  guide TEXT NOT NULL DEFAULT '',
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  likes INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opening_courses_official ON opening_courses (is_official);
CREATE INDEX IF NOT EXISTS idx_opening_courses_side ON opening_courses (side);

CREATE TABLE IF NOT EXISTS opening_lines (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES opening_courses(id) ON DELETE CASCADE,
  moves TEXT[] NOT NULL,
  explanations JSONB NOT NULL DEFAULT '[]',
  is_main_line BOOLEAN NOT NULL DEFAULT FALSE,
  parent_line_id INTEGER REFERENCES opening_lines(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE opening_lines ADD COLUMN IF NOT EXISTS name TEXT;

CREATE INDEX IF NOT EXISTS idx_opening_lines_course ON opening_lines (course_id);

CREATE TABLE IF NOT EXISTS opening_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_id INTEGER NOT NULL REFERENCES opening_lines(id) ON DELETE CASCADE,
  learned BOOLEAN NOT NULL DEFAULT FALSE,
  times_correct INTEGER NOT NULL DEFAULT 0,
  last_played_at TIMESTAMP,
  PRIMARY KEY (user_id, line_id)
);

CREATE TABLE IF NOT EXISTS opening_likes (
  course_id INTEGER NOT NULL REFERENCES opening_courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS opening_reports (
  course_id INTEGER NOT NULL REFERENCES opening_courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS opening_poll_options (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  eco_code VARCHAR(3),
  side VARCHAR(5) NOT NULL DEFAULT 'white',
  blurb TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opening_poll_votes (
  option_id INTEGER NOT NULL REFERENCES opening_poll_options(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (option_id, session_id)
);

CREATE TABLE IF NOT EXISTS opening_suggestions (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);