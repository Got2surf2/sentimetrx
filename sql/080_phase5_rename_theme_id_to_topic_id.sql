-- 080_phase5_rename_theme_id_to_topic_id.sql
--
-- Phase 5 commit 5 — fix naming drift between sql/078 column definitions
-- and the rest of the convergence (which standardised on "topic"
-- nomenclature via town_hall_topics, lib/pickNextTopic, lib/cohortThemeAggregator).
--
-- sql/078 created conversation_turns.theme_id but the COMMENT on the
-- column already references town_hall_topics(id), and the Phase 5
-- handleChatTurn / mirrorTurns code (lib/chatCore.ts + lib/phase3DualWrite.ts,
-- committed in 475d39a) writes to topic_id. Phase 6 prep against prod
-- surfaced the mismatch when the dual-write path failed with
-- "column ct.topic_id does not exist".
--
-- Resolution: rename theme_id -> topic_id. Conversation_turns is still
-- dark in production (no rows have a non-null theme_id; new path is
-- gated by TOWNHALL_VIA_AGENT_HANDLER which only flipped on locally
-- today), so the rename is a metadata-only operation with no data loss
-- risk.
--
-- Idempotent via the IF EXISTS check on the source column.

BEGIN;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_turns'
      AND column_name = 'theme_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_turns'
      AND column_name = 'topic_id'
  ) THEN
    ALTER TABLE conversation_turns RENAME COLUMN theme_id TO topic_id;
  END IF;
END $$;

-- Refresh the COMMENT in case the post-rename column lost it.
COMMENT ON COLUMN conversation_turns.topic_id IS
  'Reference to town_hall_topics(id) when the turn was assigned to a topic by PulseIQ-side matching. NULL for 1:1 bot conversations. Renamed from theme_id in sql/080 (Phase 5 commit 5) to match the rest of the convergence nomenclature.';

COMMIT;
