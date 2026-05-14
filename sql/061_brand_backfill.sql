-- sql/061_brand_backfill.sql
-- Phase 2 of the entity rebuild: backfill brand-collections from the
-- existing free-text review_sources.brand_name values.
--
-- Input (verified 2026-05-13): 9 distinct brand names across the prod
-- review_sources table. No wrong merges, no typo-splits. Capital Grille
-- already spans 2 datasets — they collapse into one brand-collection,
-- which is the intended behaviour.
--
-- Display-name cleanup: a handful of raw values are scruffy (missing
-- apostrophes, lowercased). The CASE below fixes the known ones; anything
-- else keeps its raw casing (BareBurger, Tabla Restaurant, Zuma are
-- already fine). The slug is what matters for dedup — display name is
-- cosmetic and editable later via the merge/rename UX.
--
-- Idempotent: re-running tags no new datasets (brand_tag IS NULL guard),
-- creates no duplicate collections (find_or_create dedup), inserts no
-- duplicate members (NOT EXISTS guard).

DO $$
DECLARE
  r               RECORD;
  v_display       text;
  v_collection_id uuid;
BEGIN
  -- One group per (org, brand slug). Pick the earliest source's raw name
  -- + created_by as representative so the same slug always resolves to a
  -- consistent display name + creator.
  FOR r IN
    SELECT
      rs.org_id,
      (array_agg(rs.brand_name ORDER BY rs.created_at))[1] AS raw_name,
      (array_agg(rs.created_by ORDER BY rs.created_at))[1] AS created_by,
      array_agg(DISTINCT rs.dataset_id)                    AS dataset_ids
    FROM public.review_sources rs
    WHERE rs.brand_name IS NOT NULL
      AND length(trim(rs.brand_name)) > 0
    GROUP BY rs.org_id, public.slugify(rs.brand_name)
  LOOP
    -- Cleaned display name. ELSE keeps raw casing (handles BareBurger etc).
    v_display := CASE lower(trim(r.raw_name))
      WHEN 'capital burger' THEN 'Capital Burger'
      WHEN 'eddie vs'       THEN 'Eddie V''s'
      WHEN 'flemings'       THEN 'Fleming''s'
      WHEN 'nobu'           THEN 'Nobu'
      WHEN 'ruths chris'    THEN 'Ruth''s Chris'
      ELSE trim(r.raw_name)
    END;

    v_collection_id := public.find_or_create_brand_collection(
      r.org_id, v_display, r.created_by
    );
    IF v_collection_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Tag member datasets. brand_tag IS NULL guard keeps this idempotent
    -- and avoids clobbering a tag a user may have set manually.
    UPDATE public.datasets d
    SET brand_tag           = v_display,
        brand_collection_id = v_collection_id
    WHERE d.id = ANY(r.dataset_ids)
      AND d.brand_tag IS NULL;

    -- Join the brand-collection. NOT EXISTS keeps re-runs clean.
    INSERT INTO public.collection_members (collection_id, dataset_id, label, sort_order)
    SELECT v_collection_id, d.id, d.name, 0
    FROM public.datasets d
    WHERE d.id = ANY(r.dataset_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.collection_members cm
        WHERE cm.collection_id = v_collection_id
          AND cm.dataset_id    = d.id
      );
  END LOOP;
END $$;

-- ============================================================
-- Verify
-- ============================================================
SELECT
  c.slug                                   AS brand_slug,
  (SELECT name FROM public.datasets WHERE id = c.dataset_id) AS brand_name,
  count(cm.dataset_id)                      AS member_datasets
FROM public.collections c
LEFT JOIN public.collection_members cm ON cm.collection_id = c.id
WHERE c.kind = 'brand'
GROUP BY c.id, c.slug, c.dataset_id
ORDER BY c.slug;
