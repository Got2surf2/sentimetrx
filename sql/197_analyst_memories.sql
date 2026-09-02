-- 197_analyst_memories.sql
-- "Ana remembers" — the personal layer of the Persistent Analyst design.
--
-- One row per standing instruction an analyst has confirmed (or Ana has
-- observed, pending confirmation). Memories shape Ana's FRAMING, EMPHASIS,
-- and ORDERING only — never the figures; count-changing corrections route
-- through the existing approval-gated theme tools instead. Every row is
-- visible, editable, and deletable in the "What Ana remembers" panel:
-- nothing outside this table personalizes Ana.
--
-- source provenance (the trust story, grouped in the UI):
--   interview  — day-one conversational elicitation ("you told me")
--   correction — explicit in-chat preference/correction ("you corrected me")
--   observed   — behavioral suggestion Ana offered ("I noticed"); starts
--                status='pending' until the analyst confirms it.
--
-- Writes go through the service-role /api/analyst-memory route (which pairs
-- org_id + user_id with the caller's own auth context). RLS gives org-scoped
-- read only — the multi-tenancy invariant for every new public table.

BEGIN;

CREATE TABLE IF NOT EXISTS analyst_memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  user_id     uuid NOT NULL,
  dataset_id  uuid,          -- NULL = applies org-wide; set = scoped to one dataset
  source      text NOT NULL CHECK (source IN ('interview', 'correction', 'observed')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'archived')),
  statement   text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The hot read: one analyst's active memories for prompt injection.
CREATE INDEX IF NOT EXISTS idx_analyst_memories_user
  ON analyst_memories (user_id, org_id, status);

ALTER TABLE analyst_memories ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; every mutation goes through the service-role
-- route, which stamps org_id/user_id from the authenticated caller.
DROP POLICY IF EXISTS analyst_memories_org_read ON analyst_memories;
CREATE POLICY analyst_memories_org_read ON analyst_memories
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
