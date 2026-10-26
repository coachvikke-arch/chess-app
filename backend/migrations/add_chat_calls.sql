-- WhatsApp-style 1:1 voice/video calls in chat.
--
-- A "call" row is the session record; the media itself is peer-to-peer via
-- LiveKit (room_name), with this table driving the ringing state machine:
--   ringing -> active -> ended
--            \-> declined        (callee hung up / rejected)
--            \-> missed          (callee offline or never answered)
-- Re-runnable.
CREATE TABLE IF NOT EXISTS chat_calls (
  id         SERIAL PRIMARY KEY,
  room_name  VARCHAR(80) NOT NULL UNIQUE,
  caller_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(10)  NOT NULL DEFAULT 'audio',   -- audio | video
  status     VARCHAR(20)  NOT NULL DEFAULT 'ringing', -- ringing|active|ended|declined|missed
  started_at TIMESTAMP DEFAULT NULL,
  ended_at   TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_calls_caller ON chat_calls (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_calls_callee ON chat_calls (callee_id, created_at DESC);
-- one live call per user: the busy check leans on this
CREATE INDEX IF NOT EXISTS idx_chat_calls_live ON chat_calls (caller_id, callee_id, status);
