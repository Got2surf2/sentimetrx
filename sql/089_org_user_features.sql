-- 089_org_user_features.sql
--
-- Generic feature-gating substrate. Recordings module is the first consumer;
-- the pattern is reusable for any future expensive feature (deck_generation,
-- dataforseo_bulk, etc.).
--
-- Two tables:
--   org_features  — per-org enable + monthly quota. Default for everyone in the org.
--   user_features — per-user override + monthly quota. NULL = inherit from org.
--
-- Resolution order (in lib/featureFlags.ts):
--   1. user_features row exists AND enabled IS NOT NULL → use it
--   2. Otherwise → fall back to org_features.enabled (default false if no row)
--   3. quota_per_month: user override wins if set; else org; else unlimited (NULL)
--
-- Usage counting reads usage_logs (sql/030_usage_logs.sql). Each new feature
-- decides its own resource_type/event_type convention; for recordings see
-- sql/090_recordings.sql.
--
-- Note: users.features JSONB exists from sql/020 — that's a different (older)
-- per-user dumb-flag bag. Leaving it alone; new code uses these tables.

BEGIN;

CREATE TABLE IF NOT EXISTS org_features (
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature           text NOT NULL,
  enabled           boolean NOT NULL DEFAULT false,
  quota_per_month   int,                                       -- NULL = unlimited
  enabled_at        timestamptz NOT NULL DEFAULT now(),
  enabled_by        uuid REFERENCES auth.users(id),
  PRIMARY KEY (org_id, feature)
);

CREATE INDEX IF NOT EXISTS org_features_feature_enabled_idx
  ON org_features (feature) WHERE enabled;

CREATE TABLE IF NOT EXISTS user_features (
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature           text NOT NULL,
  enabled           boolean,                                   -- NULL = inherit from org
  quota_per_month   int,                                       -- NULL = inherit from org
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);

ALTER TABLE org_features  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_features_org_read ON org_features;
CREATE POLICY org_features_org_read ON org_features
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS user_features_self_read ON user_features;
CREATE POLICY user_features_self_read ON user_features
  FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: writes happen via service role from the
-- admin routes (/api/admin/orgs/[orgId]/features and
-- /api/admin/users/[userId]/features), which are wrapped with requireAdmin.

COMMENT ON TABLE org_features IS
  'Org-level feature gates with monthly quotas. Default for every member of the org. Per-user overrides live in user_features.';

COMMENT ON TABLE user_features IS
  'Per-user feature overrides. enabled IS NULL means inherit from org_features; otherwise this row wins. quota_per_month overrides similarly.';

COMMENT ON COLUMN org_features.quota_per_month IS
  'Per-feature monthly cap on units consumed (e.g. recordings processed). NULL = unlimited. Usage counted against usage_logs scoped to the calendar month.';

COMMIT;
