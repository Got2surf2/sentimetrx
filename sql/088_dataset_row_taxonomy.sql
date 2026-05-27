-- 088_dataset_row_taxonomy.sql
--
-- Ruth's Chris taxonomy pilot (2026-05-27).
--
-- Per-row 7-axis ABSA taxonomy + cross-cutting severity flag. Replaces the
-- prospect's legacy single-bucket CX tagging vendor with a structured
-- assertions model:
--   axis ∈ {touchpoint, attribute, product, beverage, ambiance, context, outcome}
--   severity ∈ {normal | alert | crisis}  (NOT an 8th axis — cross-cutting flag)
--   polarity ∈ {pos | neg | neu}
--
-- Vocabulary lives in lib/taxonomyVocabulary.ts (closed) — the DB stores text[]
-- to keep the schema agnostic. Per-axis arrays carry just the sub-bucket names
-- (e.g. axis_touchpoint=['server','manager']); the full structured shape with
-- per-assertion polarity / confidence / severity lives in `assertions` (jsonb).
-- `alert_tags` is the subset of axis subs that fired at severity:alert/crisis,
-- for fast filtering on the admin viewer.
--
-- raw_legacy_tags preserves the prospect's existing Classification column for
-- side-by-side comparison.
--
-- Per CLAUDE.md multi-tenancy invariants: org_id is denormalized for RLS and
-- paired with every read/write; RLS is enabled day-one with an org-scoped
-- SELECT policy. Writes go through service-role from scripts/pilot-rc-classify
-- and the future production classifier, both of which pair (id, org_id) per
-- the service-role invariant.

BEGIN;

CREATE TABLE IF NOT EXISTS dataset_row_taxonomy (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  dataset_id        uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id            bigint NOT NULL,

  axis_touchpoint   text[] NOT NULL DEFAULT '{}',
  axis_attribute    text[] NOT NULL DEFAULT '{}',
  axis_product      text[] NOT NULL DEFAULT '{}',
  axis_beverage     text[] NOT NULL DEFAULT '{}',
  axis_ambiance     text[] NOT NULL DEFAULT '{}',
  axis_context      text[] NOT NULL DEFAULT '{}',
  axis_outcome      text[] NOT NULL DEFAULT '{}',
  alert_tags        text[] NOT NULL DEFAULT '{}',

  assertions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_legacy_tags   text[] NOT NULL DEFAULT '{}',

  classified_by     text,
  model_used        text,
  prompt_version    text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dataset_id, row_id)
);

CREATE INDEX IF NOT EXISTS drt_org_dataset_idx
  ON dataset_row_taxonomy (org_id, dataset_id);

CREATE INDEX IF NOT EXISTS drt_dataset_row_idx
  ON dataset_row_taxonomy (dataset_id, row_id);

CREATE INDEX IF NOT EXISTS drt_touchpoint_gin
  ON dataset_row_taxonomy USING gin (axis_touchpoint);

CREATE INDEX IF NOT EXISTS drt_attribute_gin
  ON dataset_row_taxonomy USING gin (axis_attribute);

CREATE INDEX IF NOT EXISTS drt_product_gin
  ON dataset_row_taxonomy USING gin (axis_product);

CREATE INDEX IF NOT EXISTS drt_beverage_gin
  ON dataset_row_taxonomy USING gin (axis_beverage);

CREATE INDEX IF NOT EXISTS drt_ambiance_gin
  ON dataset_row_taxonomy USING gin (axis_ambiance);

CREATE INDEX IF NOT EXISTS drt_context_gin
  ON dataset_row_taxonomy USING gin (axis_context);

CREATE INDEX IF NOT EXISTS drt_outcome_gin
  ON dataset_row_taxonomy USING gin (axis_outcome);

CREATE INDEX IF NOT EXISTS drt_alert_gin
  ON dataset_row_taxonomy USING gin (alert_tags);

ALTER TABLE dataset_row_taxonomy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dataset_row_taxonomy_org_read ON dataset_row_taxonomy;
CREATE POLICY dataset_row_taxonomy_org_read ON dataset_row_taxonomy
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- No INSERT/UPDATE/DELETE policy: writes are service-role only (scripts +
-- future production classifier). RLS-enabled-with-no-write-policy means RLS
-- implicitly denies all writes from the anon / authenticated roles.

COMMENT ON TABLE dataset_row_taxonomy IS
  'Per-row 7-axis ABSA taxonomy (Ruth''s Chris pilot 2026-05-27). axis_* text[] columns store sub-bucket names from the closed vocab in lib/taxonomyVocabulary.ts. assertions jsonb carries the full structured shape: [{axis, sub, item?, polarity, confidence, severity}]. alert_tags is the subset of axis subs that fired at severity:alert/crisis. raw_legacy_tags preserves the prospect''s legacy Classification column for side-by-side comparison.';

COMMENT ON COLUMN dataset_row_taxonomy.classified_by IS
  'Free-text origin tag. Today: "llm:claude-haiku-4-5", "llm:claude-sonnet-4-6", "mapping:legacy" (when the row came from a pure legacy-label projection without an LLM call).';

COMMENT ON COLUMN dataset_row_taxonomy.assertions IS
  'Full structured assertions. Each element: {axis, sub, item?, polarity, confidence, severity}. Per-axis text[] arrays are a denormalized projection for fast GIN-indexed filtering.';

COMMIT;
