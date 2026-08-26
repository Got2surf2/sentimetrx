-- sql/193_outlet_reporting_grandfather.sql
--
-- Grandfather the datasets that had outlet reporting under the OLD IMPLICIT rule
-- into the explicit capability introduced by 61543cc9.
--
-- Before that commit, the Leaderboard and Outlet Deep-Dive appeared automatically
-- for any google_reviews dataset with >= 5 locations. They are now gated on the
-- org `outletReporting` feature OR `dataset_state.schema_config.outletReporting`.
-- Without this backfill, shipping the gate would have REMOVED both surfaces from
-- every brand that had them.
--
-- ⚠️ ALREADY APPLIED TO PRODUCTION on 2026-08-18 by
-- `scripts/backfill-outlet-reporting.mts --prod --apply` (commit cd84dedf), which
-- enabled the flag on 12 datasets: BareBurger, Capital Grille (+ demo),
-- Ruth's Chris, Zuma, Flemings demo, Eddie V's, Tabla, Nobu, Cheddar's,
-- US National Park, Rubio's.
--
-- This file exists so the change is reconstructable from the git + schema_migrations
-- trail rather than only from a script invocation (2026-W35 audit, progression #2).
-- It is a DATA migration: no DDL, so docs/db/schema.sql does not move. Running it
-- is IDEMPOTENT and, on production, a no-op — the WHERE clause excludes rows that
-- already carry the flag.
--
-- Deliberately NOT touched: datasets with a NULL schema_config. Writing a bare
-- {"outletReporting":true} there would invent a schema_config that the rest of the
-- app then treats as authoritative (field types, hierarchy levels), so those are
-- left for an explicit Schema-tab decision. The original script skipped them for
-- the same reason and reported 0 such rows on prod.

BEGIN;

UPDATE dataset_state ds
SET    schema_config = ds.schema_config || '{"outletReporting": true}'::jsonb
FROM   datasets d
WHERE  d.id = ds.dataset_id
  AND  d.source = 'google_reviews'
  AND  d.status = 'active'
  AND  ds.schema_config IS NOT NULL
  AND  COALESCE(ds.schema_config -> 'outletReporting', 'false'::jsonb) <> 'true'::jsonb
  AND  (
         SELECT COUNT(*)
         FROM   review_source_locations rsl
         JOIN   review_sources rs ON rs.id = rsl.review_source_id
         WHERE  rs.dataset_id = d.id
       ) >= 5;

COMMIT;
