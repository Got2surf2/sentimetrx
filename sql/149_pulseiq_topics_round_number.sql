-- 149: Round-based pacing on the new PulseIQ schema (convergence item 1).
--
-- Ports sql/140's round_number column from the legacy townhall_themes to
-- pulseiq_topics, so lib/chatCore's town-hall layer can hold participants
-- between rounds exactly like the legacy orchestrator does. Semantics are
-- identical to sql/140: NULL = open-conversation pacing; round 1 seeds
-- 'active'; later rounds seed 'paused' until the moderator advances the room,
-- at which point the round's topics flip active and pickNextTopic naturally
-- routes held participants into them.
--
-- NOTE: the compat view `town_hall_topics` (sql/148) is SELECT * — the new
-- column appears in it automatically after CREATE OR REPLACE below (views
-- snapshot their column list at creation).

BEGIN;

ALTER TABLE pulseiq_topics ADD COLUMN IF NOT EXISTS round_number int;

COMMENT ON COLUMN pulseiq_topics.round_number IS
  'Round-based pacing: which round this topic belongs to (1-indexed). NULL = open-conversation pacing. Round 1 seeds active, later rounds seed paused until the moderator advances.';

CREATE INDEX IF NOT EXISTS pulseiq_topics_round_idx
  ON pulseiq_topics (town_hall_id, round_number);

-- Refresh the compat view so the new column is visible through the old name.
CREATE OR REPLACE VIEW town_hall_topics WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_topics;

COMMIT;
