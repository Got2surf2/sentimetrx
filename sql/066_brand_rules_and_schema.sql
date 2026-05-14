-- sql/066_brand_rules_and_schema.sql
-- Brand-profile coherence pass (follows the 060-062 brand-collection work).
--
-- Two changes, both additive / non-destructive:
--
--   1. collections.rules — a jsonb home for brand-level config. Today it's
--      unused; it's the reserved seam for Phase 6's on-join rules
--      (entity-discovery settings, future structured tagging rules, score
--      maps). Mirrors the organizations.features / limits jsonb pattern.
--
--   2. Brand-collections now always carry a dataset_state row. The 060
--      find_or_create_brand_collection() created the virtual dataset + the
--      collections row but no dataset_state — so a brand-collection had no
--      schema and Charts/Stats silently did nothing on it. The function now
--      inserts an empty dataset_state; the app-side rebuildBrandSchema()
--      fills in the real merged schema once membership is synced. Existing
--      brand-collections (migration 061) are backfilled with an empty
--      dataset_state here so none are left in the no-state limbo.
--
-- No new tables -> no RLS / GRANT changes. ADD COLUMN inherits the
-- collections table's existing grants + RLS.

-- ============================================================
-- 1. collections.rules
-- ============================================================
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.collections.rules IS
  'Brand-level config applied to member datasets: entity-discovery settings, future structured tagging rules, score maps. Empty {} = defaults. Unused on manual collections.';

-- ============================================================
-- 2. find_or_create_brand_collection() — also seed dataset_state
-- ============================================================
-- Same as the 060 definition, plus the dataset_state insert right after the
-- virtual dataset is created. If the collections insert below loses the
-- concurrency race, the orphan-dataset DELETE cascades this row away (the
-- dataset_state -> datasets FK is ON DELETE CASCADE).
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

  -- Empty dataset_state so the brand-collection is never in a no-state
  -- limbo. rebuildBrandSchema() (app side) fills the real merged schema
  -- once the AFTER trigger has synced collection_members.
  INSERT INTO dataset_state (dataset_id, schema_config)
  VALUES (v_dataset_id, '{"fields":[],"autoDetected":false,"version":1}'::jsonb);

  -- Create the collections linking row. ON CONFLICT covers the race where
  -- two datasets with the same brand_tag insert concurrently.
  INSERT INTO collections (dataset_id, org_id, created_by, kind, slug)
  VALUES (v_dataset_id, p_org_id, p_created_by, 'brand', v_slug)
  ON CONFLICT (org_id, slug) WHERE kind = 'brand'
  DO NOTHING
  RETURNING id INTO v_collection_id;

  IF v_collection_id IS NULL THEN
    -- Lost the race: another tx created it. Drop our orphan virtual
    -- dataset (cascades the dataset_state row) and return the winner.
    DELETE FROM datasets WHERE id = v_dataset_id;
    SELECT id INTO v_collection_id
    FROM collections
    WHERE org_id = p_org_id AND kind = 'brand' AND slug = v_slug;
  END IF;

  RETURN v_collection_id;
END;
$$;

-- ============================================================
-- 3. Backfill dataset_state for pre-existing brand-collections
-- ============================================================
-- Idempotent: NOT EXISTS guard means re-runs insert nothing.
INSERT INTO public.dataset_state (dataset_id, schema_config)
SELECT c.dataset_id, '{"fields":[],"autoDetected":false,"version":1}'::jsonb
FROM public.collections c
WHERE c.kind = 'brand'
  AND NOT EXISTS (
    SELECT 1 FROM public.dataset_state ds WHERE ds.dataset_id = c.dataset_id
  );

-- ============================================================
-- Verify
-- ============================================================
SELECT 'collections.rules column'                 AS object, 'ready' AS status
UNION ALL SELECT 'find_or_create_brand_collection (seeds dataset_state)', 'ready'
UNION ALL SELECT 'brand-collections without dataset_state: ' || count(*)::text,
  CASE WHEN count(*) = 0 THEN 'ready' ELSE 'CHECK' END
FROM public.collections c
WHERE c.kind = 'brand'
  AND NOT EXISTS (SELECT 1 FROM public.dataset_state ds WHERE ds.dataset_id = c.dataset_id);
