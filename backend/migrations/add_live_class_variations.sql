-- Shared variation tree for the live classroom board.
-- Additive and re-runnable (IF NOT EXISTS guards).
--
-- variation_tree     : serialized tree of student/coach side lines (mainline ids
--                      m1…mN are replayed, never stored here)
-- variation_pointer  : the shared review position ('root', 'm3', 'v7'…) or NULL
-- analysis_mode      : 'follow' (students follow the coach) or 'free'

ALTER TABLE chess_game_states
  ADD COLUMN IF NOT EXISTS variation_tree JSONB NOT NULL DEFAULT '{"v":1,"seq":0,"pointer":null,"promotedId":null,"nodes":[]}';

ALTER TABLE chess_game_states
  ADD COLUMN IF NOT EXISTS variation_pointer VARCHAR(32) NULL;

ALTER TABLE chess_game_states
  ADD COLUMN IF NOT EXISTS analysis_mode VARCHAR(8) NOT NULL DEFAULT 'follow';
