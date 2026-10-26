-- Automatic Chess.com rating sync.
-- Run: node run_migration.js migrations/add_chess_ratings_autosync.sql
--
-- The poll that already refreshes games now also refreshes current/best ratings
-- from /stats. This stamp is what lets the card say WHEN ratings were last
-- refreshed and throttles a manual Sync sitting right behind a poll.

ALTER TABLE connected_chess_accounts
  ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMP;
