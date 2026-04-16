-- 016_townhall_parked_state.sql
-- Add 'parked' to townhall_themes state CHECK constraint
-- Parked themes are AI suggestions saved for later activation

ALTER TABLE townhall_themes DROP CONSTRAINT IF EXISTS townhall_themes_state_check;
ALTER TABLE townhall_themes ADD CONSTRAINT townhall_themes_state_check
  CHECK (state IN ('active','detected','paused','parked','completed','dismissed'));
