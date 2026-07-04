-- sql/156_conversation_turns_town_hall_id.sql
-- Denormalize town_hall_id onto conversation_turns (CAPACITY.md §6,
-- 2026-07-04: ".in('conversation_id', convIds) filters hit a URL-length
-- cliff at a few hundred participants").
--
-- Every town-hall live surface (facilitator console, presenter screen,
-- theme detection, exports) currently resolves the hall's conversation
-- ids and passes the FULL LIST back through PostgREST query strings —
-- the request URL grows with participant count and breaks at a few
-- hundred. Stamping the hall id on each mirrored turn turns all of those
-- into a single indexed equality filter, removing the ceiling entirely.
--
-- Deliberately NO foreign key: this is a routing/filter column written by
-- the mirror; an FK would add a failure mode to the restore FK-retry
-- machinery for zero integrity gain (the authoritative link remains
-- pulseiq_session_conversations).

BEGIN;

ALTER TABLE conversation_turns
  ADD COLUMN IF NOT EXISTS town_hall_id uuid;

-- Partial index: agent (1:1) turns never set it, so keep them out of the
-- index. (town_hall_id, created_at) serves the live surfaces' recency
-- windows and count probes.
CREATE INDEX IF NOT EXISTS idx_conversation_turns_town_hall
  ON conversation_turns (town_hall_id, created_at)
  WHERE town_hall_id IS NOT NULL;

-- Backfill from the authoritative link table.
UPDATE conversation_turns ct
SET town_hall_id = psc.town_hall_id
FROM pulseiq_session_conversations psc
WHERE psc.conversation_id = ct.conversation_id
  AND ct.town_hall_id IS NULL;

COMMIT;
