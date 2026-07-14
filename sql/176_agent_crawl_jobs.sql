-- 176_agent_crawl_jobs.sql
-- AGENT_TIERS Phase 2 P2d — resumable deep crawl for Super Agents.
--
-- The single-shot /deep-crawl route does ≤30 pages in one 120s request. A super
-- agent's 300-page crawl cannot finish in one serverless invocation, so it runs
-- as a D16a browser-driven loop: the editor POSTs bounded batches and loops on
-- the persisted cursor (this table). Each row is one crawl job; a batch step
-- reads visited/queue, fetches the next N pages, ingests them, and rewrites the
-- cursor. If the tab closes the row survives at its cursor and the crawl resumes.
--
-- Idempotency (D16 has no queue retries): visited[] guards re-fetch; the ingest
-- path's exact + near-dup dedup (P2b) guards re-chunking the same content.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_crawl_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  base_urls         text[] NOT NULL DEFAULT '{}',   -- entry URLs (same-host scope)
  queue             text[] NOT NULL DEFAULT '{}',   -- URLs still to fetch (cursor)
  visited           text[] NOT NULL DEFAULT '{}',   -- URLs already fetched (dedup guard)
  page_cap          integer NOT NULL DEFAULT 300,   -- max pages this job may fetch
  pages_crawled     integer NOT NULL DEFAULT 0,
  chunks_added      integer NOT NULL DEFAULT 0,
  near_dup_skipped  integer NOT NULL DEFAULT 0,
  budget_skipped    integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','done','error','canceled')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Resume lookup: the newest running job for an agent.
CREATE INDEX IF NOT EXISTS idx_agent_crawl_jobs_agent
  ON agent_crawl_jobs (agent_id, status, created_at DESC);

ALTER TABLE agent_crawl_jobs ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; every write goes through the service-role route
-- which pairs agent_id with org_id.
DROP POLICY IF EXISTS acj_org_read ON agent_crawl_jobs;
CREATE POLICY acj_org_read ON agent_crawl_jobs
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
