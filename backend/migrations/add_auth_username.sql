-- Username-based authentication
-- 1) New columns: username + one-time recovery code (stored as SHA-256 hash only).
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_created_at TIMESTAMP;

-- Self-service signup no longer requires an email (existing admin-created rows keep theirs).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 2) Backfill usernames for existing admin-created accounts, derived from the
--    email local-part (falling back to name), guaranteed unique and lower-case.
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN SELECT id, email, name FROM users
           WHERE username IS NULL OR btrim(username) = '' ORDER BY id LOOP
    base := lower(regexp_replace(split_part(coalesce(r.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'));
    IF base = '' OR length(base) < 3 THEN
      base := lower(regexp_replace(coalesce(r.name, ''), '[^a-z0-9_]', '', 'g'));
    END IF;
    IF base = '' OR length(base) < 3 THEN
      base := 'user' || r.id;
    END IF;
    base := left(base, 20);
    candidate := base;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM users WHERE id <> r.id AND lower(username) = candidate) LOOP
      candidate := base || '_' || n;
      n := n + 1;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- 3) Case-insensitive uniqueness is enforced at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));