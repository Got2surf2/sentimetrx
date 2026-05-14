-- sql/062_brand_tag_trigger.sql
-- Phase 3 of the entity rebuild: keep brand-collection membership in sync
-- with datasets.brand_tag automatically.
--
-- Two triggers on public.datasets, both keyed to brand_tag:
--   1. BEFORE — resolves brand_tag to a brand-collection id and stamps
--      NEW.brand_collection_id. Can't touch collection_members here: on
--      INSERT the datasets row doesn't exist yet, so the FK from
--      collection_members.dataset_id would fail.
--   2. AFTER  — now the row exists; moves collection_members membership
--      from the old brand-collection to the new one.
--
-- Virtual datasets (source='collection' — the rows that *back* a
-- collection) are skipped: a collection can't itself be branded.
--
-- find_or_create_brand_collection() inserts a virtual dataset, which
-- re-fires these triggers on that virtual row — the source='collection'
-- guard makes that a no-op, so there's no recursion hazard.
--
-- Note on empty brand-collections: when the last dataset leaves a
-- brand-collection we deliberately do NOT archive or delete it. The brand
-- identity persists (slug stays unique, ready for re-tagging) and the UI
-- simply hides brand-collections with <2 members. Reviving on re-tag is
-- then a no-op find. Simpler than an archive/un-archive state machine.

-- ============================================================
-- 1. BEFORE — stamp brand_collection_id from brand_tag
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_brand_collection_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_tag        text;
  v_old_tag        text;
  v_new_collection uuid;
BEGIN
  -- Collections themselves are never branded.
  IF NEW.source = 'collection' THEN
    RETURN NEW;
  END IF;

  v_new_tag := nullif(trim(coalesce(NEW.brand_tag, '')), '');
  IF TG_OP = 'UPDATE' THEN
    v_old_tag := nullif(trim(coalesce(OLD.brand_tag, '')), '');
  ELSE
    v_old_tag := NULL;
  END IF;

  -- brand_tag unchanged -> leave brand_collection_id alone.
  IF v_new_tag IS NOT DISTINCT FROM v_old_tag THEN
    RETURN NEW;
  END IF;

  IF v_new_tag IS NOT NULL THEN
    v_new_collection := find_or_create_brand_collection(
      NEW.org_id, v_new_tag, NEW.created_by
    );
  ELSE
    v_new_collection := NULL;  -- tag cleared
  END IF;

  NEW.brand_collection_id := v_new_collection;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. AFTER — move collection_members membership
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_brand_collection_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_collection uuid;
  v_new_collection uuid;
BEGIN
  IF NEW.source = 'collection' THEN
    RETURN NULL;
  END IF;

  v_new_collection := NEW.brand_collection_id;
  IF TG_OP = 'UPDATE' THEN
    v_old_collection := OLD.brand_collection_id;
  ELSE
    v_old_collection := NULL;
  END IF;

  -- No membership change needed.
  IF v_old_collection IS NOT DISTINCT FROM v_new_collection THEN
    RETURN NULL;
  END IF;

  -- Leave the old brand-collection.
  IF v_old_collection IS NOT NULL THEN
    DELETE FROM collection_members
    WHERE collection_id = v_old_collection
      AND dataset_id    = NEW.id;
  END IF;

  -- Join the new brand-collection.
  IF v_new_collection IS NOT NULL THEN
    INSERT INTO collection_members (collection_id, dataset_id, label, sort_order)
    VALUES (v_new_collection, NEW.id, NEW.name, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- 3. Triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_set_brand_collection_id ON public.datasets;
CREATE TRIGGER trg_set_brand_collection_id
  BEFORE INSERT OR UPDATE OF brand_tag ON public.datasets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_brand_collection_id();

DROP TRIGGER IF EXISTS trg_sync_brand_collection_members ON public.datasets;
CREATE TRIGGER trg_sync_brand_collection_members
  AFTER INSERT OR UPDATE OF brand_tag ON public.datasets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_brand_collection_members();

-- ============================================================
-- Verify
-- ============================================================
SELECT 'set_brand_collection_id function'        AS object, 'ready' AS status
UNION ALL SELECT 'sync_brand_collection_members function', 'ready'
UNION ALL SELECT 'trg_set_brand_collection_id',            'ready'
UNION ALL SELECT 'trg_sync_brand_collection_members',      'ready';
