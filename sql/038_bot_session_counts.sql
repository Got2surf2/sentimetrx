-- 038: bot_session_counts_for_ids RPC
--
-- Replaces the JS-side dedup in app/api/bots/route.ts which pulled
-- every (bot_id, session_id) pair across all listed bots and built
-- in-memory Sets to count distinct sessions. Scales linearly with
-- total turns (10+ bots × 10k turns = 100k rows transferred).
--
-- New RPC does count(distinct session_id) per bot in Postgres,
-- using idx_bot_turns_session(bot_id, session_id, turn_number)
-- for an index-only scan.
--
-- Apply via the production Supabase SQL Editor.

CREATE OR REPLACE FUNCTION bot_session_counts_for_ids(p_bot_ids uuid[])
RETURNS TABLE(
  bot_id        uuid,
  session_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bot_id,
    count(DISTINCT session_id)::bigint AS session_count
  FROM bot_conversation_turns
  WHERE bot_id = ANY(p_bot_ids)
  GROUP BY bot_id;
$$;

REVOKE ALL ON FUNCTION bot_session_counts_for_ids(uuid[]) FROM public;
GRANT  EXECUTE ON FUNCTION bot_session_counts_for_ids(uuid[]) TO authenticated, service_role;
