-- 114_dataset_row_field_taxonomy.sql
--
-- Per-FIELD taxonomy ("Dimensions") storage (2026-06-06).
--
-- WHY a new table instead of altering dataset_row_taxonomy:
--   The existing dataset_row_taxonomy is keyed UNIQUE(dataset_id, row_id) — ONE
--   classification per row — and the LIVE production app upserts into it on every
--   Google-reviews sync (lib/reviewSync → classifyPendingRows, onConflict
--   'dataset_id,row_id'). Changing that table's unique to include `field` would
--   break the running app's writes. So this is an ADDITIVE new table; the old one
--   is left untouched and retired once the per-field code ships everywhere.
--
-- Shape mirrors 088 but adds `field text` and keys UNIQUE(dataset_id, row_id, field)
-- so a single dataset row can carry independent tags for each open-ended field
-- (e.g. a survey's "Liked Most" vs "Liked Least"). The Dimensions tab reads the
-- rollup filtered by the field the user is analyzing → it reacts to the ANALYZE
-- toggle the same way TextMine themes do.
--
-- Per CLAUDE.md multi-tenancy invariants: org_id denormalized + paired on every
-- read/write; RLS enabled day-one with an org-scoped SELECT policy; writes are
-- service-role only (no write policy ⇒ RLS denies anon/authenticated writes).

BEGIN;

CREATE TABLE IF NOT EXISTS dataset_row_field_taxonomy (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  dataset_id        uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id            bigint NOT NULL,
  field             text NOT NULL,        -- the open-ended field these tags were derived from

  axis_touchpoint   text[] NOT NULL DEFAULT '{}',
  axis_attribute    text[] NOT NULL DEFAULT '{}',
  axis_product      text[] NOT NULL DEFAULT '{}',
  axis_beverage     text[] NOT NULL DEFAULT '{}',
  axis_ambiance     text[] NOT NULL DEFAULT '{}',
  axis_context      text[] NOT NULL DEFAULT '{}',
  axis_outcome      text[] NOT NULL DEFAULT '{}',
  alert_tags        text[] NOT NULL DEFAULT '{}',

  assertions        jsonb NOT NULL DEFAULT '[]'::jsonb,

  classified_by     text,
  model_used        text,
  prompt_version    text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dataset_id, row_id, field)
);

-- org+dataset+field is the rollup's read pattern (all a dataset's tags for one field).
CREATE INDEX IF NOT EXISTS drft_org_dataset_field_idx
  ON dataset_row_field_taxonomy (org_id, dataset_id, field);

CREATE INDEX IF NOT EXISTS drft_dataset_field_row_idx
  ON dataset_row_field_taxonomy (dataset_id, field, row_id);

CREATE INDEX IF NOT EXISTS drft_touchpoint_gin ON dataset_row_field_taxonomy USING gin (axis_touchpoint);
CREATE INDEX IF NOT EXISTS drft_attribute_gin  ON dataset_row_field_taxonomy USING gin (axis_attribute);
CREATE INDEX IF NOT EXISTS drft_product_gin    ON dataset_row_field_taxonomy USING gin (axis_product);
CREATE INDEX IF NOT EXISTS drft_beverage_gin   ON dataset_row_field_taxonomy USING gin (axis_beverage);
CREATE INDEX IF NOT EXISTS drft_ambiance_gin   ON dataset_row_field_taxonomy USING gin (axis_ambiance);
CREATE INDEX IF NOT EXISTS drft_context_gin    ON dataset_row_field_taxonomy USING gin (axis_context);
CREATE INDEX IF NOT EXISTS drft_outcome_gin    ON dataset_row_field_taxonomy USING gin (axis_outcome);
CREATE INDEX IF NOT EXISTS drft_alert_gin      ON dataset_row_field_taxonomy USING gin (alert_tags);

ALTER TABLE dataset_row_field_taxonomy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dataset_row_field_taxonomy_org_read ON dataset_row_field_taxonomy;
CREATE POLICY dataset_row_field_taxonomy_org_read ON dataset_row_field_taxonomy
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
-- No INSERT/UPDATE/DELETE policy: writes are service-role only.

COMMENT ON TABLE dataset_row_field_taxonomy IS
  'Per-(dataset,row,field) 7-axis ABSA taxonomy (2026-06-06). Like dataset_row_taxonomy but keyed by the open-ended `field` the tags came from, so the Dimensions tab can show per-field results that react to the ANALYZE toggle. axis_* text[] = sub-bucket names from lib/taxonomyVocabulary.ts; assertions jsonb = full {axis,sub,item?,polarity,confidence,severity,evidence}; alert_tags = subs that fired at alert/crisis.';

-- Per-field analog of dataset_rows_pending_taxonomy (sql/108): rows of a dataset
-- whose `field` is non-empty but have NO dataset_row_field_taxonomy entry for that
-- field yet. Drives the drift "classify the new rows" nudge per field.
CREATE OR REPLACE FUNCTION dataset_rows_pending_field_taxonomy(
  p_dataset_id uuid,
  p_field      text,
  p_limit      int DEFAULT 1000
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
    LEFT JOIN dataset_row_field_taxonomy t
      ON t.dataset_id = f.dataset_id AND t.row_id = f.id AND t.field = p_field
   WHERE f.dataset_id = p_dataset_id
     AND t.row_id IS NULL
     -- "Has real text" must match the keyword classifier, which strips control
     -- chars + whitespace before deciding a row is empty. A plain btrim (spaces
     -- only) counts tab/newline/control-only rows as text → they'd be "pending"
     -- forever (the classifier writes no row for them). Strip all whitespace +
     -- control chars and check what's left.
     AND COALESCE(regexp_replace(f.data ->> p_field, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
   ORDER BY f.row_index
   LIMIT p_limit;
$$;

-- Count of rows WITH text in a given field (the "rows with text" denominator the
-- Dimensions header reconciles against — % tagged = tagged / rows-with-text).
CREATE OR REPLACE FUNCTION dataset_rows_with_text_count(
  p_dataset_id uuid,
  p_field      text
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     -- Same "has real text" test as the classifier (strip whitespace + control),
     -- so this denominator == rows the classifier actually tags. Avoids a
     -- perpetual "N rows aren't tagged" drift nudge for whitespace-only rows.
     AND COALESCE(regexp_replace(f.data ->> p_field, '[[:space:][:cntrl:]]+', '', 'g'), '') <> '';
$$;

COMMIT;
