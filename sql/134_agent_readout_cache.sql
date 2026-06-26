-- 134_agent_readout_cache.sql
--
-- Cache table backing the Agent Conversation Readout — the content-first
-- companion to the Agent Study. Where the Study leads with health/ops metrics,
-- the Readout leads with WHAT participants asked and raised:
--
--   • Questions by theme   — every substantive user question, themed. Hybrid:
--                            scaffolded on the agent's declared focuses, with
--                            emergent themes mined for anything outside them.
--   • Raised beyond the    — the volunteered observations/concerns/suggestions
--     questions              users offered unprompted, themed the same way.
--
-- Memoized like agent_study_cache: one row per bot, keyed on a content hash
-- (pair count + focus catalog + title) so it self-heals when conversations or
-- config change. See lib/agentReadout.ts and docs/BOTS.md § Conversation Readout.
--
-- Per CLAUDE.md multi-tenancy invariants: org_id is paired with every row, RLS
-- is enabled day-one with an org-scoped SELECT policy, and writes are
-- service-role only (no INSERT/UPDATE policy -> RLS implicitly denies writes
-- from anon/authenticated roles).

BEGIN;

CREATE TABLE IF NOT EXISTS agent_readout_cache (
  bot_id      uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  cache_key   text NOT NULL,
  analysis    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_readout_cache_org_idx
  ON agent_readout_cache (org_id);

ALTER TABLE agent_readout_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_readout_cache_org_read ON agent_readout_cache;
CREATE POLICY agent_readout_cache_org_read ON agent_readout_cache
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE agent_readout_cache IS
  'Memoized Agent Conversation Readout analysis object, one row per bot. cache_key is a content hash over normalized-pair count + focus catalog + report title; a mismatch triggers recompute so the cache self-heals when conversations or config change. Written service-role-only from lib/agentReadout.ts. Mirrors agent_study_cache.';

COMMENT ON COLUMN agent_readout_cache.cache_key IS
  'Content hash: normalized-pair turn_count + focus catalog + readout title. Stale key -> recompute. Mirrors agent_study_cache.cache_key.';

COMMIT;
