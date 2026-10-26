-- Concurrent-device session cap (a user may be signed in on at most 2 devices).
--
-- Every successful login inserts a row here and the JWT carries its id as
-- `session_id`. The auth middleware then only honours a token whose session is
-- still active, so when a THIRD device signs in the oldest session gets
-- `revoked_at` stamped and that device's next request is rejected with
-- SESSION_REVOKED (which the client turns into a forced logout).

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(128),                       -- client-generated, stable per install
  device_name VARCHAR(150),                     -- human label, e.g. "Chrome on Windows"
  platform VARCHAR(60),                         -- android | ios | windows | macos | linux | web
  refresh_token_hash TEXT,                      -- sha256 of the opaque refresh token
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP
);

-- The hot path is "how many non-revoked sessions does this user have?" and
-- "which is the oldest?" — both covered by this composite index.
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions (user_id, revoked_at);

-- Reuse-on-relogin lookup: is there already an active session for this device?
CREATE INDEX IF NOT EXISTS idx_user_sessions_device
  ON user_sessions (user_id, device_id, revoked_at);

-- At most ONE active session per (user, device). Revoked rows are excluded, so
-- history is preserved while a device can never hold two live sessions at once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_active_device
  ON user_sessions (user_id, device_id)
  WHERE revoked_at IS NULL AND device_id IS NOT NULL;
