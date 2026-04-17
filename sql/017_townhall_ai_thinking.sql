-- 017: Add ai_thinking column to townhall_turns
-- Stores AI reasoning steps when verbose/debug mode is active
-- 2026-04-17

ALTER TABLE townhall_turns
  ADD COLUMN IF NOT EXISTS ai_thinking JSONB DEFAULT NULL;

COMMENT ON COLUMN townhall_turns.ai_thinking IS 'AI reasoning steps captured in verbose mode (array of strings)';
