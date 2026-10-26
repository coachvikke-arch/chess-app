-- 1:1 DM support columns for chat_messages (additive + re-runnable).
-- DMs are private sender->recipient rows with no class scope:
--   * sender_id    - author of a private message (class chat keeps user_id)
--   * live_class_id - made nullable: a DM may exist outside any class
--   * user_id      - made nullable: a DM has no class-chat row to own it
-- Existing class rows backfill sender_id = user_id so history keeps an author.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE chat_messages SET sender_id = user_id WHERE sender_id IS NULL;

ALTER TABLE chat_messages ALTER COLUMN live_class_id DROP NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN user_id DROP NOT NULL;

-- Index used by the conversation scan (sender OR recipient).
CREATE INDEX IF NOT EXISTS idx_chat_messages_dm_sender
  ON chat_messages (sender_id, created_at DESC);