-- End-of-game reason for online / classroom games.
--
-- `result` already stores WHO won ('white' | 'black' | 'draw' | 'abandoned');
-- this adds WHY the game ended so the live classroom can show it:
--   'checkmate' | 'resignation' | 'timeout' | 'stalemate' | 'repetition'
--   | 'insufficient' | 'agreement'
--
-- Nullable and additive: existing finished rows keep a NULL reason and the UI
-- falls back to the plain winner text. Safe to re-run.

ALTER TABLE online_games ADD COLUMN IF NOT EXISTS result_reason VARCHAR(20);
