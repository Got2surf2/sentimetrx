-- 084_agents_probe_focus_enabled.sql
--
-- Probe-focus tagging (docs/BOTS.md § 9.x.1) — mirrors the existing
-- assistant-side focus classifier (lib/focusClassifier.ts) over the
-- USER turn. When enabled per-bot, every user turn ≥3 words gets a
-- post-insert classification that tags `topic:<slug>` onto
-- content_flags via the bot's existing focuses catalog.
--
-- Why a per-bot toggle: AI cost guardrail. Adds one Haiku call per
-- user turn. Disabled by default — explicit opt-in per bot.
--
-- This unblocks matched/mismatched prompt↔response analysis: with
-- focus:<slug> on assistant turns (existing) AND topic:<slug> on
-- user turns (this feature), the two can be diffed to surface
-- mismatches like "bot asked about housing, user answered about
-- traffic instead."
--
-- Use case: NOWOCATS launch — every PM-2 conversation gets the
-- legal-defensibility benefit of being able to slice "what residents
-- actually talked about, by topic" even when the bot's prompt
-- steered toward something else.

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS probe_focus_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN agents.probe_focus_enabled IS
  'When true, lib/chatCore.ts fires lib/probeFocusClassifier.classifyProbeFocuses on every user turn (post-insert, fire-and-forget) and tags content_flags with topic:<slug>. Mirrors the assistant-side focus classifier. Disabled by default — opt-in per bot to control AI cost.';

COMMIT;

SELECT 'probe_focus_enabled column exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='agents' AND column_name='probe_focus_enabled'
  ) THEN 'ready' ELSE 'MISSING' END;
