-- sql/063_entity_catalog.sql
-- Phase 4 of the entity rebuild: the catalog tables.
--
-- entity_catalog is a flat *list* of canonical entity names per scope —
-- not per-row tags. ~50-200 rows per brand, discovered from a small
-- Haiku NER sample. Counts are NOT stored here: they're computed live
-- via Postgres full-text search at filter time, so they stay accurate
-- across the full dataset regardless of sample size.
--
-- Scope is either a single dataset (scope_type='dataset') or a
-- collection (scope_type='collection' — covers brand-collections and
-- manual collections). A dataset with a brand_collection_id reads the
-- collection-scoped catalog; a dataset without one reads its own.
--
-- entity_catalog_refresh is an append-only audit log of every discovery
-- run — initial, incremental (new dataset joined), manual, or weekly
-- cron. Lets an owner answer "when did this catalog last refresh and
-- what changed".
--
-- This replaces 058_entity_mentions (per-row tags) and
-- 059_top_entities_for_theme. Those are dropped in 065 once the app code
-- has moved over.

-- ============================================================
-- 1. entity_catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type    text NOT NULL CHECK (scope_type IN ('dataset', 'collection')),
  scope_id      uuid NOT NULL,
  canonical     text NOT NULL,                 -- "Filet Mignon"
  slug          text NOT NULL,                 -- slugify(canonical), join key
  category      text NOT NULL DEFAULT 'other', -- 'food' | 'person' | 'place' | ...
  aliases       text[] NOT NULL DEFAULT '{}',  -- raw variants seen ("the filet", "filet")
  sample_count  int NOT NULL DEFAULT 1,        -- times seen in discovery samples (not a row count)
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- One catalog entry per (scope, entity). Re-discovery upserts.
  CONSTRAINT entity_catalog_uniq UNIQUE (scope_type, scope_id, slug)
);

-- Top-entities read path (sorted by how often discovery saw it).
CREATE INDEX IF NOT EXISTS entity_catalog_scope_count_idx
  ON public.entity_catalog (scope_type, scope_id, sample_count DESC);
-- Category rollup read path.
CREATE INDEX IF NOT EXISTS entity_catalog_scope_category_idx
  ON public.entity_catalog (scope_type, scope_id, category);

COMMENT ON TABLE public.entity_catalog IS
  'Flat list of canonical entities per scope (dataset or collection). Discovered from a Haiku NER sample. Counts are NOT stored — computed live via full-text search at filter time. Populated by lib/entityDiscovery.ts.';
COMMENT ON COLUMN public.entity_catalog.sample_count IS
  'How many times discovery samples have surfaced this entity. A discovery-frequency hint, NOT a dataset mention count. Real counts come from runtime full-text search.';

-- ============================================================
-- 2. entity_catalog_refresh — append-only audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_catalog_refresh (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type           text NOT NULL CHECK (scope_type IN ('dataset', 'collection')),
  scope_id             uuid NOT NULL,
  triggered_by         text NOT NULL CHECK (triggered_by IN ('initial', 'incremental', 'manual', 'cron')),
  triggered_by_user    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_at         timestamptz NOT NULL DEFAULT now(),
  sample_size          int,
  datasets_sampled     uuid[],
  entities_before      int,
  entities_after       int,
  entities_new         int,
  haiku_cost_est_cents int,
  duration_ms          int,
  error                text
);

CREATE INDEX IF NOT EXISTS entity_catalog_refresh_scope_idx
  ON public.entity_catalog_refresh (scope_type, scope_id, triggered_at DESC);

COMMENT ON TABLE public.entity_catalog_refresh IS
  'Append-only audit log of entity-discovery runs. One row per run (initial / incremental / manual / cron). Drives the "last refreshed" UI + cost tracking.';

-- ============================================================
-- 3. Grants (Supabase Data API access pattern)
-- ============================================================
-- entity_catalog: discovery upserts (INSERT + UPDATE for merge), re-runs
-- may DELETE stale rows. All through service-role in API routes.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_catalog TO service_role;
-- entity_catalog_refresh: append-only.
GRANT SELECT, INSERT ON public.entity_catalog_refresh TO service_role;
-- authenticated / anon: no direct access — reads go through API routes
-- that gate by scope ownership (with admin-org bypass).

-- ============================================================
-- 4. RLS — default-deny
-- ============================================================
ALTER TABLE public.entity_catalog        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_catalog_refresh ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon -> default deny. Service-role
-- bypasses RLS and is the only reader/writer path. Same defense-in-depth
-- pattern as 057_user_events / 058_entity_mentions.

-- ============================================================
-- Verify
-- ============================================================
SELECT 'entity_catalog table'           AS object, 'ready' AS status
UNION ALL SELECT 'entity_catalog indexes',          'ready'
UNION ALL SELECT 'entity_catalog_refresh table',    'ready'
UNION ALL SELECT 'entity_catalog_refresh index',    'ready'
UNION ALL SELECT 'RLS enabled on both',             'ready';
