-- Chat attachments (WhatsApp-style) for DMs + group avatars.
-- Additive and re-runnable (guards in place).

-- 1:1 DM rows can carry an uploaded file/image alongside (or instead of) text.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachment TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size INTEGER;

-- Group profile picture (set by admins).
ALTER TABLE chat_groups
  ADD COLUMN IF NOT EXISTS avatar TEXT;