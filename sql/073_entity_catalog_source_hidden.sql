-- sql/073_entity_catalog_source_hidden.sql
-- Add `source` and `hidden` to entity_catalog so the catalog can carry
-- hand-curated entries alongside discovered ones and let users soft-delete
-- NER noise that keeps coming back on re-discovery.
--
-- Why both columns:
--   source  — 'discovered' (NER write) or 'manual' (user create / menu seed).
--             Lets the "Reset discovered" action wipe NER junk without losing
--             curation. Lets discovery upserts skip rows it didn't create.
--   hidden  — soft-delete flag. A `discovered` row hidden by a user must stay
--             hidden across future discovery runs (otherwise NER keeps re-
--             surfacing the same noise). Hidden rows are excluded from the
--             reads in lib/entityFilter.ts.
--
-- Hard-delete remains valid for `manual` rows (user added it, user can drop it).
-- Hidden + manual is the path for "I added this then realised I don't want it
-- and don't trust myself not to re-add it."
--
-- Migration is additive. Existing rows default to source='discovered',
-- hidden=false — preserving today's behaviour. Index supports the read filter
-- `WHERE scope_type=? AND scope_id=? AND hidden=false`.

ALTER TABLE public.entity_catalog
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'discovered'
    CHECK (source IN ('discovered', 'manual')),
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS entity_catalog_scope_visible_idx
  ON public.entity_catalog (scope_type, scope_id)
  WHERE hidden = false;

COMMENT ON COLUMN public.entity_catalog.source IS
  'How this row entered the catalog. ''discovered'' = NER write (lib/entityDiscovery.ts). ''manual'' = user create or menu-PDF seed. Discovery upserts only touch ''discovered'' rows.';

COMMENT ON COLUMN public.entity_catalog.hidden IS
  'Soft-delete flag. Hidden rows are excluded from cloud / compare / drill-down reads but persist so re-discovery does not resurface them. Toggle from the Schema tab.';

-- ============================================================
-- Verify
-- ============================================================
SELECT 'entity_catalog.source column' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='entity_catalog' AND column_name='source')
            THEN 'ready' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'entity_catalog.hidden column',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='entity_catalog' AND column_name='hidden')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'entity_catalog_scope_visible_idx',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname='public' AND tablename='entity_catalog' AND indexname='entity_catalog_scope_visible_idx')
            THEN 'ready' ELSE 'MISSING' END;
