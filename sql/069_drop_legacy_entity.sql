-- sql/069_drop_legacy_entity.sql
-- Phase 7: drop the v1 entity-mentions layer.
--
-- Why: 063_entity_catalog + 064_entity_counts replaced the per-row v1 design.
-- The catalog stores canonical entities once per dataset (or brand-collection)
-- and 064's count_entity_terms() does live full-text counting — so the v1
-- per-row entity_mentions table, the top_entities_for_theme() rollup, and the
-- datasets.entity_extraction_state run-tracking column are all dead. Verified:
-- zero references in app/lib/scripts (ask-ana reads getEntitiesWithCounts from
-- lib/entityFilter; lib/entityExtraction.ts was already removed in an earlier phase).
--
-- This is destructive and one-way. There is no v1 data worth keeping — the
-- catalog is rebuilt lazily on compute and weekly by the entity-discovery cron.

-- ============================================================
-- 1. Drop the theme rollup function (reads entity_mentions)
-- ============================================================
DROP FUNCTION IF EXISTS public.top_entities_for_theme(uuid, text[], text[], text, int);

-- ============================================================
-- 2. Drop the per-row mentions table (CASCADE clears its indexes + RLS policies)
-- ============================================================
DROP TABLE IF EXISTS public.entity_mentions CASCADE;

-- ============================================================
-- 3. Drop the per-field extraction-state column on datasets
-- ============================================================
ALTER TABLE public.datasets DROP COLUMN IF EXISTS entity_extraction_state;

-- ============================================================
-- Verify — all three should report 'dropped'
-- ============================================================
SELECT 'entity_mentions table' AS object,
       CASE WHEN to_regclass('public.entity_mentions') IS NULL
            THEN 'dropped' ELSE 'STILL EXISTS' END AS status
UNION ALL
SELECT 'top_entities_for_theme()' AS object,
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_proc WHERE proname = 'top_entities_for_theme'
            ) THEN 'dropped' ELSE 'STILL EXISTS' END AS status
UNION ALL
SELECT 'datasets.entity_extraction_state' AS object,
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'datasets'
                AND column_name = 'entity_extraction_state'
            ) THEN 'dropped' ELSE 'STILL EXISTS' END AS status;
