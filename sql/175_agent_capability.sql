-- 175_agent_capability.sql
-- AGENT_TIERS Phase 1 — tier split MVP. Adds the capability knob to agents.
--
-- `capability` selects the knob set resolved in lib/agentCapability.ts
-- (model / maxTokens / RAG chunks / history window / input cap / verbosity).
-- `capability_config` holds per-agent overrides — today just the super-tier
-- model choice ({ "model": "claude-opus-4-8" | "claude-sonnet-4-6" }); the
-- resolver falls back to the Opus 4.8 default when unset/invalid.
--
-- No backfill needed: DEFAULT 'standard' preserves today's behavior for every
-- existing agent (standard knobs == the current hardcoded values).

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS capability text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS capability_config jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_capability_check'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_capability_check CHECK (capability IN ('standard', 'super'));
  END IF;
END $$;
