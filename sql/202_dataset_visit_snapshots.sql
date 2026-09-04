-- 202_dataset_visit_snapshots.sql
-- Dataset digest — per-analyst "last looked" state (owner surface decision
-- 2026-09-04: the digest leads Ana's opening briefing).
--
-- One row per (user, dataset): the compact state snapshot taken at that
-- analyst's most recent Ana briefing ({rowCount, themeCounts, themeFieldKey}
-- — lib/anaDigest.ts VisitSnapshot). The next briefing diffs the stored
-- snapshot against current state IN CODE and injects the delta block, then
-- upserts the fresh snapshot. "Last visit" therefore means "last briefing" —
-- deliberate: chatting for an hour after a briefing doesn't move the marker.
--
-- Writes go through the service-role ask-ana route (org_id paired with the
-- dataset's own org). RLS gives org-scoped read only — the multi-tenancy
-- invariant for every new public table.

BEGIN;

CREATE TABLE IF NOT EXISTS dataset_visit_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  user_id     uuid NOT NULL,
  dataset_id  uuid NOT NULL,
  snapshot    jsonb NOT NULL,
  visited_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dataset_id)
);

ALTER TABLE dataset_visit_snapshots ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; every mutation goes through the service-role
-- route, which pairs org_id/user_id with the caller's own auth context.
DROP POLICY IF EXISTS dataset_visit_snapshots_org_read ON dataset_visit_snapshots;
CREATE POLICY dataset_visit_snapshots_org_read ON dataset_visit_snapshots
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
