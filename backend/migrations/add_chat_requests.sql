-- Coach-approval-gated user-to-user messaging.
--
-- WHY THIS IS A NEW TABLE AND NOT A COLUMN ON chat_messages
-- -------------------------------------------------------
-- 1:1 DMs in this app are DERIVED, not stored: listConversations groups
-- chat_messages rows (is_private = TRUE) by sender/recipient pair. There has
-- never been a conversation row, so there is nowhere to hang "these two people
-- are allowed to talk". chat_requests records the *permission*, and
-- conversations is the durable pairing record it creates on approval.
--
-- Direction vs pairing
-- -------------------
-- A chat_request is DIRECTIONAL (requester -> target) because the requester is
-- the one who needs approval and the one who gets notified. The permission it
-- grants is SYMMETRIC: once approved, both people may message both ways.
-- So every permission lookup normalises the pair with LEAST/GREATEST and matches
-- either direction.
--
-- Only ONE pending request per direction
-- -------------------------------------
-- The duplicate guard is a PARTIAL unique index on status = 'pending' rather
-- than a plain UNIQUE (requester, target, status). A plain unique would also
-- block a second 'rejected' row, i.e. it would make the re-request rule
-- impossible to implement, and 'approved' duplicates are equally meaningless.
-- The partial index gives exactly the guarantee we want: at most one in-flight
-- request per direction, while history accumulates freely.

CREATE TABLE IF NOT EXISTS chat_requests (
  id                  SERIAL PRIMARY KEY,
  requester_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The coach who actually decides this request. Resolved at creation time
  -- (target's primary coach, else superadmin fallback) so the inbox is a plain
  -- indexed lookup and the decision has a stable owner even if the student is
  -- reassigned to another coach afterwards.
  target_coach_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMP,
  rejected_at         TIMESTAMP,
  approved_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- A user cannot request a chat with themselves. Directional because A->B and
  -- B->A are different requests; the symmetric pairing is only meaningful once
  -- a request is approved.
  CONSTRAINT ck_chat_requests_not_self CHECK (requester_user_id <> target_user_id)
);

-- At most one pending request per direction. This is the database-level
-- backstop for "do not create duplicate requests" - the controller checks
-- first, but two concurrent clicks must not both win.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_requests_one_pending
  ON chat_requests (requester_user_id, target_user_id)
  WHERE status = 'pending';

-- The coach's actionable queue: "show me pending requests assigned to me".
CREATE INDEX IF NOT EXISTS idx_chat_requests_coach_queue
  ON chat_requests (target_coach_id, status, created_at DESC);

-- Eligibility lookups run per profile open, always filtered to one pair.
CREATE INDEX IF NOT EXISTS idx_chat_requests_pair
  ON chat_requests (requester_user_id, target_user_id, created_at DESC);

-- Super Admin's all-requests view, filtered by status.
CREATE INDEX IF NOT EXISTS idx_chat_requests_status
  ON chat_requests (status, created_at DESC);

-- Durable pairing record, created when a request is approved.
--
-- user1_id < user2_id is enforced by a CHECK constraint rather than trusted to
-- application code: it guarantees a canonical pair so the unique index really
-- does collapse both directions onto one conversation. Without it, A->B and
-- B->A could each insert a row and produce two half-empty threads.
--
-- status is separate from chat_requests.status on purpose: a conversation can
-- be 'active' while its originating request sits in history as 'approved', and
-- revoking messaging later must not rewrite the approval record.
CREATE TABLE IF NOT EXISTS conversations (
  id               SERIAL PRIMARY KEY,
  user1_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_request_id  INTEGER REFERENCES chat_requests(id) ON DELETE SET NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_conversations_pair UNIQUE (user1_id, user2_id),
  CONSTRAINT ck_conversations_canonical_order CHECK (user1_id < user2_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations (user1_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations (user2_id, updated_at DESC);

-- Re-request rules, which the spec defers to configuration. One row, id = 1,
-- seeded so a read never has to cope with an empty table.
--
-- Defaults: a rejected requester may ask again, but not immediately. A 7-day
-- cooldown stops a rejected pair from spamming the same coach while still
-- letting a genuine reason resurface later. Super Admin can turn re-requests
-- off entirely (allow_rerequest = FALSE) or change the window.
CREATE TABLE IF NOT EXISTS chat_request_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  allow_rerequest         BOOLEAN NOT NULL DEFAULT TRUE,
  rerequest_cooldown_days INTEGER NOT NULL DEFAULT 7 CHECK (rerequest_cooldown_days >= 0),
  updated_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO chat_request_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;