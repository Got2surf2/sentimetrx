-- sql/060_brand_collections.sql
-- Phase 1 of the entity-extraction rebuild: brand collections foundation.
--
-- Background: entities need a scope. A "brand" (Capital Grille) can own
-- several datasets across different sources — Google Reviews, a survey, a
-- Reddit thread, a PulseIQ session. We want one entity catalog per brand,
-- inherited by every member dataset, so cross-source filtering works.
--
-- Rather than invent a parallel concept, a brand IS a collection with
-- kind='brand'. Collections already do cross-dataset analysis (TextMine,
-- theme mining, stats all sum across members). Brand-collections are
-- auto-curated: a free-text `brand_tag` on a dataset find-or-creates the
-- brand-collection and joins it (the trigger that does this lands in
-- migration 062).
--
-- A collection is stored as a "virtual dataset" (datasets row with
-- source='collection') plus a `collections` linking row plus
-- `collection_members` rows. find_or_create_brand_collection() below
-- replicates that three-part shape.

-- ============================================================
-- 1. slugify() — canonical brand key
-- ============================================================
-- "The Capital Grille", "Capital Grille", "capital grille" all collapse
-- to 'capital_grille'. Leading articles stripped; apostrophes removed
-- (so "Ruth's Chris" and "Ruths Chris" match); non-alphanumeric runs
-- become single underscores.
CREATE OR REPLACE FUNCTION public.slugify(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '_' from
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(trim(coalesce(p_input, ''))),
          '^(the|a|an)\s+', ''        -- strip leading article
        ),
        '[''`’]', '', 'g'             -- strip apostrophes / curly quotes
      ),
      '[^a-z0-9]+', '_', 'g'          -- non-alphanumeric runs -> underscore
    )
  );
$$;

COMMENT ON FUNCTION public.slugify(text) IS
  'Canonical slug for brand names. Strips leading articles + apostrophes, lowercases, underscores non-alphanumerics. Used for brand-collection dedup.';

-- ============================================================
-- 2. collections: kind + slug
-- ============================================================
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual', 'brand'));

ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS slug text;

COMMENT ON COLUMN public.collections.kind IS
  'manual = user-curated analytical grouping (today''s behaviour). brand = auto-curated by datasets.brand_tag; represents a real-world brand and owns an entity catalog.';
COMMENT ON COLUMN public.collections.slug IS
  'Canonical slug (slugify(name)) for brand-collections. NULL for manual collections. Unique per org among brand-collections.';

-- One brand-collection per (org, slug). Partial index so manual
-- collections (slug NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS collections_brand_slug_uniq
  ON public.collections (org_id, slug)
  WHERE kind = 'brand';

-- ============================================================
-- 3. datasets: brand_tag + brand_collection_id
-- ============================================================
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS brand_tag text;

ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS brand_collection_id uuid
    REFERENCES public.collections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.datasets.brand_tag IS
  'User-facing brand name typed on the dataset (e.g. "Capital Grille"). The trigger in 062 normalises this via slugify() and find-or-creates the brand-collection.';
COMMENT ON COLUMN public.datasets.brand_collection_id IS
  'The brand-collection this dataset belongs to (collections.id, kind=brand). Set by the 062 trigger from brand_tag. NULL = dataset has no brand; entity catalog is dataset-scoped.';

CREATE INDEX IF NOT EXISTS datasets_brand_collection_idx
  ON public.datasets (brand_collection_id)
  WHERE brand_collection_id IS NOT NULL;

-- ============================================================
-- 4. find_or_create_brand_collection()
-- ============================================================
-- Returns the collections.id for a brand. Creates the virtual dataset +
-- collections row on first call for a given (org, slug). Idempotent and
-- concurrency-safe: a unique-violation race re-selects the winner.
--
-- SECURITY DEFINER so it can run from the 062 trigger and the 061
-- backfill regardless of the caller's RLS context. search_path pinned
-- per the migration-044 hardening standard.
CREATE OR REPLACE FUNCTION public.find_or_create_brand_collection(
  p_org_id      uuid,
  p_brand_tag   text,
  p_created_by  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug          text;
  v_collection_id uuid;
  v_dataset_id    uuid;
BEGIN
  v_slug := slugify(p_brand_tag);
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN NULL;
  END IF;

  -- Fast path: already exists.
  SELECT id INTO v_collection_id
  FROM collections
  WHERE org_id = p_org_id AND kind = 'brand' AND slug = v_slug;
  IF FOUND THEN
    RETURN v_collection_id;
  END IF;

  -- Create the virtual dataset that represents the collection.
  INSERT INTO datasets (org_id, name, source, created_by, status, visibility)
  VALUES (p_org_id, trim(p_brand_tag), 'collection', p_created_by, 'active', 'private')
  RETURNING id INTO v_dataset_id;

  -- Create the collections linking row. ON CONFLICT covers the race where
  -- two datasets with the same brand_tag insert concurrently.
  INSERT INTO collections (dataset_id, org_id, created_by, kind, slug)
  VALUES (v_dataset_id, p_org_id, p_created_by, 'brand', v_slug)
  ON CONFLICT (org_id, slug) WHERE kind = 'brand'
  DO NOTHING
  RETURNING id INTO v_collection_id;

  IF v_collection_id IS NULL THEN
    -- Lost the race: another tx created it. Drop our orphan virtual
    -- dataset and return the winner.
    DELETE FROM datasets WHERE id = v_dataset_id;
    SELECT id INTO v_collection_id
    FROM collections
    WHERE org_id = p_org_id AND kind = 'brand' AND slug = v_slug;
  END IF;

  RETURN v_collection_id;
END;
$$;

COMMENT ON FUNCTION public.find_or_create_brand_collection(uuid, text, uuid) IS
  'Returns collections.id for a brand, creating the virtual dataset + collections row on first call. Idempotent, concurrency-safe. Called by the 062 trigger and the 061 backfill.';

-- ============================================================
-- Verify
-- ============================================================
SELECT 'slugify function'                     AS object, 'ready' AS status
UNION ALL SELECT 'collections.kind',                       'ready'
UNION ALL SELECT 'collections.slug + unique index',        'ready'
UNION ALL SELECT 'datasets.brand_tag',                     'ready'
UNION ALL SELECT 'datasets.brand_collection_id',           'ready'
UNION ALL SELECT 'find_or_create_brand_collection',        'ready'
UNION ALL SELECT 'slugify check: The Capital Grille => ' || slugify('The Capital Grille'), 'ready'
UNION ALL SELECT 'slugify check: Ruth''s Chris => '       || slugify('Ruth''s Chris'),     'ready'
UNION ALL SELECT 'slugify check: Ruths Chris => '         || slugify('Ruths Chris'),       'ready';
