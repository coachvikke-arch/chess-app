-- Public player card: an unguessable share token per user and a visibility
-- switch. The QR code on My Profile encodes /card/<public_token>; the public
-- endpoint reads ONLY the safe fields listed in publicCardController.
--
-- Run: node run_migration.js migrations/add_public_player_card.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_public BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill every existing account with a 122-bit random token. gen_random_uuid()
-- is built into Postgres 13+ (no pgcrypto extension needed) and is seeded by the
-- OS CSPRNG, unlike random()/md5(clock_timestamp()).
UPDATE users
   SET public_token = replace(gen_random_uuid()::text, '-', '')
 WHERE public_token IS NULL;

-- Two users must never share a QR target. NULLs are allowed by a plain unique
-- index, but the backfill above leaves none.
CREATE UNIQUE INDEX IF NOT EXISTS users_public_token_key ON users (public_token);
