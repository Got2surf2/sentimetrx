-- sql/146_townhall_session_counts.sql
-- Per-session participant + response counts for the town-hall sessions list.
--
-- The sessions route computed these by fetching every turn for all listed
-- sessions with a single `.in('session_id', ids)` — no .range() — then tallying
-- in JS. Supabase caps an unbounded select at 1000 rows, so once an org's listed
-- sessions collectively exceed 1000 turns the counts silently undercount (a
-- correctness bug on the dashboard, not just slow). This aggregates in Postgres
-- so the counts are exact at any volume, mirroring bot_session_counts_for_ids
-- (sql/038).
--
--   participants = distinct participant_id per session
--   responses    = turns that were answered (not skipped, non-empty user_message)
--
-- Additive: inert until the sessions route calls it.

BEGIN;

CREATE OR REPLACE FUNCTION townhall_session_counts_for_ids(p_session_ids uuid[])
RETURNS TABLE(
  session_id   uuid,
  participants bigint,
  responses    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    session_id,
    count(DISTINCT participant_id)::bigint AS participants,
    count(*) FILTER (
      WHERE skipped IS NOT TRUE
        AND user_message IS NOT NULL
        AND user_message <> ''
    )::bigint AS responses
  FROM townhall_turns
  WHERE session_id = ANY(p_session_ids)
  GROUP BY session_id;
$$;

REVOKE ALL ON FUNCTION townhall_session_counts_for_ids(uuid[]) FROM public;
GRANT  EXECUTE ON FUNCTION townhall_session_counts_for_ids(uuid[]) TO authenticated, service_role;

COMMIT;
