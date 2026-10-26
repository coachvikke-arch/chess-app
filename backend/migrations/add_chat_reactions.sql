-- Emoji reactions on chat messages (1:1 DMs and group rooms share one table,
-- discriminated by `scope`). Re-runnable.
CREATE TABLE IF NOT EXISTS chat_reactions (
  id         SERIAL PRIMARY KEY,
  scope      TEXT    NOT NULL DEFAULT 'dm',      -- 'dm' | 'group'
  message_id INTEGER NOT NULL,                  -- chat_messages.id or chat_group_messages.id
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_message
  ON chat_reactions (scope, message_id);
