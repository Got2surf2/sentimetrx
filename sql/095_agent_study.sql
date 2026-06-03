-- 095_agent_study.sql
--
-- Two tables backing the Agent Study report (the HTML report + PPTX export
-- that replaces the old conversations-page "Deck" + "Mine Conversations"
-- buttons). See docs/BOTS.md § Agent Study and docs/ANALYTICS.md.
--
--   agent_impressions   — widget-open beacon. Persisted turns only exist once
--                         the user sends a first message (lib/chatCore.ts gates
--                         all turn writes on session_id from the first POST), so
--                         a pure "opened, never typed" visit leaves NO trace in
--                         conversation tables. This beacon is the only way to
--                         count true invocations and compute an honest
--                         open -> engaged response rate. Written fire-and-forget
--                         from the public widget on mount.
--
--   agent_study_cache   — memoized Tier-2 (AI) analysis object, keyed on a
--                         content hash (turn_count + focus/intent config) so it
--                         self-heals when conversations or config change. One
--                         row per bot (upsert).
--
-- Per CLAUDE.md multi-tenancy invariants: org_id is paired with every row,
-- RLS is enabled day-one with an org-scoped SELECT policy, and writes are
-- service-role only (no INSERT/UPDATE policy -> RLS implicitly denies writes
-- from anon/authenticated roles).

BEGIN;

-- ── Impressions (widget-open beacon) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_impressions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  bot_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  -- Anonymous client-generated id (NOT a session_id — the widget has no
  -- conversation session until the first message). Used only to dedupe rapid
  -- re-mounts within a visit; never joined to PII.
  visitor_id  text,
  source      text,
  medium      text,
  campaign    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_impressions_bot_created_idx
  ON agent_impressions (bot_id, created_at DESC);

ALTER TABLE agent_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_impressions_org_read ON agent_impressions;
CREATE POLICY agent_impressions_org_read ON agent_impressions
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE agent_impressions IS
  'Widget-open beacon for agents. One row per public-widget mount, written fire-and-forget by POST /api/bots/[id]/impression. The ONLY source of true invocation counts: conversation turns are written only after the first user message, so opens that never become conversations are otherwise invisible. Powers the open->engaged response rate on the agent card + Agent Study report.';

-- ── Study cache (memoized AI analysis) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_study_cache (
  bot_id      uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  cache_key   text NOT NULL,
  analysis    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_study_cache_org_idx
  ON agent_study_cache (org_id);

ALTER TABLE agent_study_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_study_cache_org_read ON agent_study_cache;
CREATE POLICY agent_study_cache_org_read ON agent_study_cache
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE agent_study_cache IS
  'Memoized Tier-2 (AI) Agent Study analysis object, one row per bot. cache_key is a content hash over turn_count + focus/intent config; a mismatch triggers recompute so the cache self-heals when conversations or config change. Written service-role-only from lib/agentStudy.ts.';

COMMENT ON COLUMN agent_study_cache.cache_key IS
  'Content hash: normalized-pair turn_count + focus catalog + intent catalog. Stale key -> recompute. Mirrors the signalStats row_count+model-hash freshness pattern.';

COMMIT;
