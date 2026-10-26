-- Message deletion, WhatsApp-style, with two separate outcomes:
--
--   mode = 'everyone'  -> the row is physically deleted (chat_messages or
--                          chat_group_messages) for all participants.
--   mode = 'me'        -> the row stays; this table records that I hid it, and
--                          thread loads filter those ids out for me only.
--
-- One table for both scopes ('dm' | 'group'), matching chat_reactions.
-- Re-runnable.
CREATE TABLE IF NOT EXISTS chat_message_deletions (
  id         SERIAL PRIMARY KEY,
  scope      VARCHAR(10) NOT NULL DEFAULT 'dm',   -- 'dm' | 'group'
  message_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (scope, message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_deletions_msg
  ON chat_message_deletions (scope, message_id);
