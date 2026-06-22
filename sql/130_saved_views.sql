-- 130_saved_views.sql
-- Saved Views, Snapshots & Periods (see docs/SAVED_VIEWS.md).
--
-- A "view" is a saved FilterContext state (live recipe) on a single dataset.
-- A "snapshot" is a view frozen at a moment: aggregates-only, self-contained
-- (carries its own filter_config + frozen results, no back-reference to a view).
-- Same table, distinguished by `kind`.
--
-- Reuses helpers defined in earlier migrations:
--   touch_updated_at()  -> 001_schema.sql
--   is_platform_admin() -> 001_schema.sql
--   current_org_id()    -> 008_campaigns.sql

CREATE TABLE IF NOT EXISTS saved_views (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id        UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'view' CHECK (kind IN ('view', 'snapshot')),
  visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'org')),
  filter_config     JSONB NOT NULL DEFAULT '{}',   -- serialized filters (+ period spec)
  frozen            JSONB,                          -- snapshots only: resolved range + captured aggregates
  source_view_name  TEXT,                           -- snapshots only: provenance LABEL (not a ref; never dangles)
  expires_at        TIMESTAMPTZ,                    -- snapshots only: retention clock; NULL = kept forever
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER saved_views_updated_at
  BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_views_dataset ON saved_views(dataset_id, kind);
CREATE INDEX IF NOT EXISTS idx_saved_views_org ON saved_views(org_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Views are private-by-default; visibility='org' opts a row into
-- org-wide read. Mutation stays with the creator (or platform admin).
-- (API writes go through the service role + explicit org/ownership
-- gating; these policies are the backstop for any non-service access.)
-- ============================================================
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_views_select ON saved_views FOR SELECT
  USING (
    is_platform_admin()
    OR (org_id = current_org_id() AND (visibility = 'org' OR created_by = auth.uid()))
  );

CREATE POLICY saved_views_insert ON saved_views FOR INSERT
  WITH CHECK (
    is_platform_admin()
    OR (org_id = current_org_id() AND created_by = auth.uid())
  );

CREATE POLICY saved_views_update ON saved_views FOR UPDATE
  USING (
    is_platform_admin()
    OR (org_id = current_org_id() AND created_by = auth.uid())
  );

CREATE POLICY saved_views_delete ON saved_views FOR DELETE
  USING (
    is_platform_admin()
    OR (org_id = current_org_id() AND created_by = auth.uid())
  );
