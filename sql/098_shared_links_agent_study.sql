-- 098_shared_links_agent_study.sql
-- Add 'agent_study' to the shared_links.type CHECK constraint so the Agent
-- Study report can be shared as a point-in-time HTML bake (stored in
-- shared_links.metadata.html, served by /shared/agent-study/[token]).
--
-- Mirrors how 'conversation' / 'analytics' were added in 018. No new columns —
-- the metadata JSONB column already exists.

BEGIN;

ALTER TABLE shared_links DROP CONSTRAINT IF EXISTS shared_links_type_check;
ALTER TABLE shared_links ADD CONSTRAINT shared_links_type_check
  CHECK (type IN ('study', 'campaign', 'townhall', 'conversation', 'analytics', 'agent_study'));

COMMIT;
