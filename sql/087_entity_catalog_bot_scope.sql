-- sql/087_entity_catalog_bot_scope.sql
-- Extend entity_catalog scope to cover bots (agents), enabling per-agent
-- named-entity catalogs sourced from the agent's KB. See docs/BOTS.md § 9.y.
--
-- Why: today entity_catalog only covers datasets + collections. Each shipped
-- agent (MCO, UCF Incubator, Hope, Sarina/NOWOCATS, Sir O'Gate) has a rich
-- named-entity vocabulary buried in its KB that we can't structurally query.
-- Adding 'bot' as a scope lets us reuse all existing primitives — RLS
-- (default-deny + service-role-only writes), source/hidden columns from 073,
-- the entity_catalog_refresh audit log — with no new tables.
--
-- scope_id for 'bot' rows is bots.id (= agents.id; the bots/agents rename
-- is still deferred, the table is the same row set).
--
-- Migration is additive. Existing 'dataset' / 'collection' rows are
-- untouched. The CHECK constraint must be re-created (no ADD VALUE for
-- table-level CHECK constraints in Postgres).
--
-- The entity_catalog_refresh.triggered_by CHECK constraint stays as
-- ('initial','incremental','manual','cron') — bot extracts use 'manual'
-- (admin-clicked button only; see docs/BOTS.md § 9.y open Q1).

BEGIN;

-- entity_catalog: add 'bot' to scope_type CHECK
ALTER TABLE public.entity_catalog
  DROP CONSTRAINT IF EXISTS entity_catalog_scope_type_check;

ALTER TABLE public.entity_catalog
  ADD CONSTRAINT entity_catalog_scope_type_check
  CHECK (scope_type IN ('dataset', 'collection', 'bot'));

-- entity_catalog_refresh: same widening on its scope_type CHECK
ALTER TABLE public.entity_catalog_refresh
  DROP CONSTRAINT IF EXISTS entity_catalog_refresh_scope_type_check;

ALTER TABLE public.entity_catalog_refresh
  ADD CONSTRAINT entity_catalog_refresh_scope_type_check
  CHECK (scope_type IN ('dataset', 'collection', 'bot'));

-- Partial index for the bot read path. The existing
-- entity_catalog_scope_count_idx covers (scope_type, scope_id, sample_count
-- DESC) for all scopes, but a partial index keyed on scope_id alone is
-- cheaper for the common "list this bot's visible entities" query.
CREATE INDEX IF NOT EXISTS idx_entity_catalog_bot_scope
  ON public.entity_catalog (scope_id)
  WHERE scope_type = 'bot';

COMMIT;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'entity_catalog scope_type check accepts bot' AS object,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.check_constraints
         WHERE constraint_name = 'entity_catalog_scope_type_check'
           AND check_clause LIKE '%bot%'
       ) THEN 'ready' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'entity_catalog_refresh scope_type check accepts bot',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.check_constraints
         WHERE constraint_name = 'entity_catalog_refresh_scope_type_check'
           AND check_clause LIKE '%bot%'
       ) THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'idx_entity_catalog_bot_scope',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'idx_entity_catalog_bot_scope'
       ) THEN 'ready' ELSE 'MISSING' END;
