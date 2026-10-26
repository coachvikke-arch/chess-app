-- Presence + unread tracking for 1:1 private chat (student <-> coach and
-- student <-> student). Additive and re-runnable; never drops columns.
--   users.last_seen_at     - server-side "last seen" used for the offline
--                            fallback ("last seen 5m ago") AND as the delayed
--                            presence source when a socket is not connected.
--   chat_messages.read_at  - when the recipient opened/marked the conversation.
--                            unread_count = COUNT(*) WHERE recipient_id = me AND
--                            read_at IS NULL (both participation directions).
--   heartbeat_grace_bucket - powers the green dot purely in-memory server-side
--                            (60s grace after the last socket disconnect).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON chat_messages (recipient_id, read_at)
  WHERE read_at IS NULL;

-- Navigation helpers: pairing key between two users, used by the sidebar to
-- group DMs into stable single conversations regardless of who initiated.
-- Keeping this additive and index-only (no new table) so nothing that already
-- depends on chat_messages changes shape.
CREATE INDEX IF NOT EXISTS idx_chat_messages_dm_scan
  ON chat_messages (recipient_id, created_at DESC);
