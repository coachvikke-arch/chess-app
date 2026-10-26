-- Group chat: admins create groups, members chat 1:many in real time with
-- attachments (images/files). Additive and re-runnable (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS chat_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

-- Per-member read cursor so each member gets their own unread badge.
CREATE TABLE IF NOT EXISTS chat_group_reads (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_group_messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  attachment TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_group ON chat_group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_messages_group ON chat_group_messages (group_id, created_at DESC);