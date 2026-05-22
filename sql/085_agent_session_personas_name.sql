-- 085_agent_session_personas_name.sql
--
-- Name capture (open queue followup) — adds a structured `name` column
-- to agent_session_personas. Populated by a post-response AI extractor
-- (lib/nameExtractor.ts) that scans recent user messages for a first
-- name explicitly stated or contextually clear.
--
-- Why a real column instead of stuffing into persona jsonb: name is
-- the primary identifier the conversations admin UI displays per
-- session (today shows "Anonymous" for ~88% of sessions because the
-- existing regex heuristics only fire on "my name is X" / short
-- capitalized first messages / greeting-extract from the bot reply —
-- catches very few real cases). Putting name in a top-level column
-- keeps the admin UI query simple (`select name from agent_session_personas`).
--
-- Backfill: not run by this migration. After this lands, sessions with
-- no extracted name show NULL. The extractor populates new sessions
-- going forward; for historical sessions, a separate one-off script
-- (TBD) can backfill by reading bot_conversation_turns user content
-- and calling extractName.

BEGIN;

ALTER TABLE agent_session_personas
  ADD COLUMN IF NOT EXISTS name text;

CREATE INDEX IF NOT EXISTS agent_session_personas_name_idx
  ON agent_session_personas (bot_id, name)
  WHERE name IS NOT NULL;

COMMENT ON COLUMN agent_session_personas.name IS
  'First name extracted via lib/nameExtractor.ts (post-response AI scan). Null if no name was given or could not be reliably extracted. Populated fire-and-forget from lib/chatCore.ts on user_turn_count == 2 (retry once at 5) and only when currently null — once set, no further extraction calls for this session.';

COMMIT;

SELECT 'name column exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='agent_session_personas' AND column_name='name'
  ) THEN 'ready' ELSE 'MISSING' END;
