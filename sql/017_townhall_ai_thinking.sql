-- 017: Add ai_thinking column + update source check constraint on townhall_turns
-- Stores AI reasoning steps when verbose/debug mode is active
-- Adds 'standby', 'deflect', 'language_switch', 'system' to valid source values
-- 2026-04-17

ALTER TABLE townhall_turns
  ADD COLUMN IF NOT EXISTS ai_thinking JSONB DEFAULT NULL;

COMMENT ON COLUMN townhall_turns.ai_thinking IS 'AI reasoning steps captured in verbose mode (array of strings)';

-- Drop old restrictive source CHECK and replace with updated list
ALTER TABLE townhall_turns DROP CONSTRAINT IF EXISTS townhall_turns_source_check;
ALTER TABLE townhall_turns ADD CONSTRAINT townhall_turns_source_check
  CHECK (source IN ('guide','clarifier','detected_theme','custom','deflect','standby','language_switch','system'));
