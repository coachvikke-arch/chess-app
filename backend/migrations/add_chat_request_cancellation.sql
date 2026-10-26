-- Cancelling a chat request at ANY point in its life, including after approval.
--
-- Why the record needs its own cancellation columns
-- -------------------------------------------------
-- 'cancelled' was already a legal chat_requests.status (add_chat_requests.sql
-- put it in the CHECK), but it only ever meant "the requester withdrew a request
-- that nobody had decided yet". There was nowhere to say WHO cancelled an
-- APPROVED chat, WHEN, or WHY - and an approved chat is exactly the one whose
-- disappearance users will ask about later.
--
-- cancelled_by is ON DELETE SET NULL, like approved_by/rejected_by: a cancelled
-- chat must not be able to fail to display just because an account was removed.
-- cancel_reason is free text and stays NULL when nobody gave one, because the
-- dialog makes the reason optional.
--
-- A cancelled chat is NOT an approval that can be revived. evaluateAccess reads
-- the newest request, so once this row is 'cancelled' the pair has no live
-- approval and the only way back is a brand-new request, re-decided by the panel.
ALTER TABLE chat_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE chat_requests ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Oversight and dispute resolution: "who stopped this chat, when, and why".
-- Approve/reject already record their actor on the row itself; cancellation is
-- the one decision whose reason lives nowhere else, so the whole decision history
-- is also kept here in an append-only ledger rather than read back off the row.
CREATE TABLE IF NOT EXISTS chat_request_audit (
  id                SERIAL PRIMARY KEY,
  chat_request_id   INTEGER NOT NULL REFERENCES chat_requests(id) ON DELETE CASCADE,
  action            VARCHAR(20) NOT NULL
                      CHECK (action IN ('approved', 'rejected', 'cancelled')),
  -- actor_name is copied in rather than resolved through actor_id: a deleted
  -- account must still leave a readable trail, which is the whole point of an
  -- audit row. It is display metadata only and is never used for a permission
  -- check.
  actor_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name        TEXT,
  previous_status   VARCHAR(20),
  new_status        VARCHAR(20),
  reason            TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_request_audit_request
  ON chat_request_audit (chat_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_request_audit_action
  ON chat_request_audit (action, created_at DESC);