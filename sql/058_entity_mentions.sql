-- sql/058_entity_mentions.sql
-- Per-row entity tags for open-ended fields.
--
-- Why: today we have an entity-analysis deck endpoint that runs Haiku
-- canonicalisation against an open-ended field and returns a PPTX. The
-- pipeline aggregates raw mentions but loses row provenance, so we can't
-- (a) filter TextMine by entity, (b) ask "which entities co-occur with
-- theme X", or (c) let Ana reason about entity-level questions.
--
-- This migration adds the persistence layer. One row per (dataset row,
-- canonical entity) pair. The canonicalisation lib writes to it on a
-- user-triggered "Extract entities" action per dataset+field; the read
-- APIs hang off it.
--
-- Grant pattern: explicit GRANTs to service_role; default-deny RLS
-- (admins read via service-role through admin endpoints). Same pattern
-- as 057_user_events.

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_mentions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id    uuid    NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  row_id        bigint  NOT NULL REFERENCES public.dataset_rows_flat(id) ON DELETE CASCADE,
  source_field  text    NOT NULL,
  canonical     text    NOT NULL,
  raw_mention   text    NOT NULL,
  category      text    NOT NULL DEFAULT 'other',
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One entity per (row, field, canonical) — multiple raw variants of the
  -- same canonical in the same cell collapse to one row.
  CONSTRAINT entity_mentions_uniq UNIQUE (dataset_id, row_id, source_field, canonical)
);

CREATE INDEX IF NOT EXISTS entity_mentions_dataset_canonical_idx
  ON public.entity_mentions (dataset_id, canonical);
CREATE INDEX IF NOT EXISTS entity_mentions_dataset_category_idx
  ON public.entity_mentions (dataset_id, category);
CREATE INDEX IF NOT EXISTS entity_mentions_row_idx
  ON public.entity_mentions (row_id);
CREATE INDEX IF NOT EXISTS entity_mentions_dataset_field_idx
  ON public.entity_mentions (dataset_id, source_field);

COMMENT ON TABLE public.entity_mentions IS
  'Per-row tagged entities extracted from open-ended fields. Populated by lib/entityExtraction.ts on user-triggered "Extract entities" action. Read by /api/datasets/[id]/entities, theme cards, TextMine, and Ask Ana.';

-- ============================================================
-- 2. Extraction-state tracking on datasets
-- ============================================================
-- Tracks which fields have been extracted and when, so the Schema tab can
-- show "Last extracted: <date>" and decide whether to re-extract on new
-- rows. Stored as JSON keyed by field name: { "<field>": { "at": "...",
-- "rows_scanned": N, "entities_found": N } }.
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS entity_extraction_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.datasets.entity_extraction_state IS
  'Per-field extraction history: { "<field>": { "at", "rows_scanned", "entities_found" } }. Keyed by source_field. Updated by lib/entityExtraction.ts.';

-- ============================================================
-- 3. Grants (Supabase Data API access pattern)
-- ============================================================
GRANT SELECT, INSERT, DELETE ON public.entity_mentions TO service_role;
-- authenticated has no direct access — reads go through API routes that
-- gate by dataset.org_id (with admin-org bypass).
-- anon: no access.

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.entity_mentions ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS, which is the only writer/reader path.
-- No policies for authenticated/anon means default deny — defense in
-- depth in case a future grant accidentally opens it up.

-- ============================================================
-- Verify
-- ============================================================
SELECT 'entity_mentions table' AS object, 'ready' AS status
UNION ALL SELECT 'entity_mentions indexes', 'ready'
UNION ALL SELECT 'datasets.entity_extraction_state', 'ready';
