-- 177_agent_kb_page_hashes.sql
-- AGENT_TIERS Phase 2 P2e — per-page content-hash store for the super-only
-- weekly re-crawl cron.
--
-- The cron (app/api/cron/agent-recrawl) walks each Super Agent's training_urls,
-- fetches the current page, and hashes the extracted text. If the hash matches
-- the last stored hash for that (agent, url), the page is UNCHANGED and is
-- skipped — no re-chunk, no re-embed (the whole point of hash-diffing: refresh
-- cost stays near-zero for a stable site). When the hash differs (or the page is
-- new), that page's chunks are replaced and this row is upserted with the new
-- hash. One row per (agent_id, url).
--
-- Super-tier only (owner 2026-07-14, AGENT_TIERS §7 #4): auto re-crawl is a paid
-- differentiator; standard agents stay manual-refresh. The cron enforces the
-- tier — nothing here is capability-gated, this is just the hash ledger.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_kb_page_hashes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url             text NOT NULL,
  content_hash    text NOT NULL,           -- sha256 hex of the extracted page text
  last_crawled_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, url)
);

-- Per-agent load of all stored hashes (the cron reads them in one pass per agent).
CREATE INDEX IF NOT EXISTS idx_akph_agent ON agent_kb_page_hashes (agent_id);

ALTER TABLE agent_kb_page_hashes ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; every write goes through the service-role cron
-- which pairs agent_id with org_id.
DROP POLICY IF EXISTS akph_org_read ON agent_kb_page_hashes;
CREATE POLICY akph_org_read ON agent_kb_page_hashes
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
