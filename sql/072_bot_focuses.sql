-- sql/072_bot_focuses.sql
-- Add `focuses` JSONB column to `bots` for the Prompt Focus feature.
--
-- A "focus" is a bot-side topic/coverage area (parallel to but distinct from
-- `intents`, which are user-side signals). When a bot has focuses defined, the
-- chat route runs a post-response classification call to identify which focus(es)
-- the assistant reply addressed, and appends `focus:<slug>` entries to the
-- `content_flags` array on the resulting `bot_conversation_turns` row.
--
-- Conversations admin then filters / aggregates by focus the same way it does
-- by intent today.
--
-- Default is empty array: existing bots are unaffected until someone defines
-- focuses for them, either via the editor UI or via a seed script.
--
-- Each focus entry has shape:
--   { slug: string, label: string, description: string, enabled: boolean }
-- Slug is the durable machine identifier (lowercase, snake_case).
-- Description is the prompt-side hint used by the classifier.

BEGIN;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS focuses JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN bots.focuses IS
  'Array of {slug, label, description, enabled} objects. When non-empty, the chat route classifies each assistant reply against the list and appends focus:<slug> entries to bot_conversation_turns.content_flags. Parallel to but distinct from `intents` (which are user-side signal detection).';

COMMIT;
