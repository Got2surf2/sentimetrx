-- sql/154_pulseiq_response_counters.sql
-- Restore the original town-hall incremental-counter design on the unified
-- substrate (owner directive 2026-07-04: "it was every X turns, user
-- specifiable — total waste to recompute frequently").
--
-- The legacy design kept an atomic session counter
-- (townhall_sessions.response_counter, sql/144) so the every-N theme-
-- detection trigger cost O(1) per turn. The unified engine lost it in the
-- convergence: it re-derived cohort totals and per-topic tallies from
-- conversation_turns on EVERY participant message. This migration:
--   1. adds pulseiq_sessions.response_counter (the trigger total),
--   2. gives pulseiq_topics.response_count (column already exists, was
--      never maintained) an atomic maintainer,
--   3. backfills both from the analytics mirror,
--   4. drops the dead sql/144 function (it targets townhall_sessions,
--      DROPPED in sql/153 — calling it errors).
--
-- chatCore increments via the RPC once per stored assistant reply and
-- READS the counters; nothing counts turns per-message anymore.

BEGIN;

ALTER TABLE pulseiq_sessions
  ADD COLUMN IF NOT EXISTS response_counter integer NOT NULL DEFAULT 0;

-- Atomic increment: bumps the session total and (when the reply was
-- tagged with a topic) that topic's tally. Topic update pairs id with
-- town_hall_id so a stray topic id can't cross sessions. Returns the new
-- session total — the caller compares it against
-- cohort_config.theme_detection_every_n_responses.
CREATE OR REPLACE FUNCTION increment_pulseiq_response_counter(
  p_session_id uuid,
  p_topic_id uuid DEFAULT NULL,
  p_delta integer DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter integer;
BEGIN
  IF p_topic_id IS NOT NULL THEN
    UPDATE pulseiq_topics
    SET response_count = COALESCE(response_count, 0) + p_delta
    WHERE id = p_topic_id AND town_hall_id = p_session_id;
  END IF;

  UPDATE pulseiq_sessions
  SET response_counter = COALESCE(response_counter, 0) + p_delta
  WHERE id = p_session_id
  RETURNING response_counter INTO v_counter;

  RETURN v_counter;
END;
$$;

COMMENT ON FUNCTION increment_pulseiq_response_counter(uuid, uuid, integer) IS
  'Atomically bumps pulseiq_sessions.response_counter (+ the tagged topic''s response_count) per stored assistant reply. Returns the new session total. Replaces per-turn COUNT queries in chatCore (2026-07-04).';

-- Backfill from the analytics mirror (role='assistant' topic-tagged turns,
-- matching the semantics the live counting used).
UPDATE pulseiq_topics t
SET response_count = sub.n
FROM (
  SELECT ct.topic_id, count(*) AS n
  FROM conversation_turns ct
  JOIN pulseiq_session_conversations psc ON psc.conversation_id = ct.conversation_id
  WHERE ct.role = 'assistant' AND ct.topic_id IS NOT NULL
  GROUP BY ct.topic_id
) sub
WHERE t.id = sub.topic_id;

UPDATE pulseiq_sessions s
SET response_counter = sub.n
FROM (
  SELECT psc.town_hall_id, count(*) AS n
  FROM conversation_turns ct
  JOIN pulseiq_session_conversations psc ON psc.conversation_id = ct.conversation_id
  WHERE ct.role = 'assistant' AND ct.topic_id IS NOT NULL
  GROUP BY psc.town_hall_id
) sub
WHERE s.id = sub.town_hall_id;

-- Dead since sql/153 dropped townhall_sessions; calling it errors.
DROP FUNCTION IF EXISTS increment_townhall_response_counter(uuid);

COMMIT;
