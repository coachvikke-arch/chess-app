-- Private student → coach messages (DMs) in the live classroom.
-- Additive and re-runnable.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;