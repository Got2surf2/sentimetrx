-- 155_taxonomy_keyset.sql
--
-- Keyset pagination for the two remaining quadratic OFFSET scans in the
-- taxonomy blob path (deferred from the 2026-07-04 efficiency audit):
--
--   1. taxonomy_rows_for_field — the rollup recompute pages with
--      `ORDER BY f.id OFFSET p_offset`, so page k re-walks (and re-detoasts
--      the data blob of) every row of pages 1..k-1: O(n²) detoast per rollup.
--   2. dataset_rows_pending_field_taxonomy — the auto-classify drain has no
--      cursor at all; every call (and every loop iteration inside one call)
--      re-evaluates the `_tx ? field` predicate — a blob detoast — on every
--      already-classified row before reaching the pending ones.
--
-- Both get `p_after_id bigint DEFAULT NULL`: when non-null the scan resumes
-- with `f.id > p_after_id ORDER BY f.id LIMIT p_limit` (id is immutable, so
-- pages are stable even while the drain UPDATEs the table it is paging, and
-- rows before the cursor are skipped by a cheap bigint compare — no detoast).
-- When NULL the legacy behavior (p_offset / row_index order) is preserved so
-- code deployed before this migration's companion commit keeps working.
--
-- Adding a defaulted param changes the signature, and keeping the old
-- signature as a second overload would make every PostgREST RPC call
-- ambiguous (a named-arg call without p_after_id matches both). So: DROP the
-- exact old signature and CREATE the new one in the same transaction.

BEGIN;

-- ── 1. taxonomy_rows_for_field (sql/151) — rollup page read ──────────────────

DROP FUNCTION IF EXISTS taxonomy_rows_for_field(uuid, text, text, text, int, int);

CREATE OR REPLACE FUNCTION taxonomy_rows_for_field(
  p_dataset_id   uuid,
  p_field_key    text,
  p_rating_field text   DEFAULT NULL,
  p_date_field   text   DEFAULT NULL,
  p_offset       int    DEFAULT 0,
  p_limit        int    DEFAULT 1000,
  p_after_id     bigint DEFAULT NULL
)
RETURNS TABLE(row_id bigint, tx jsonb, rating_val text, date_val text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id,
         f.data -> '_tx' -> 'f' -> p_field_key,
         CASE WHEN p_rating_field IS NOT NULL THEN f.data ->> p_rating_field END,
         CASE WHEN p_date_field   IS NOT NULL THEN f.data ->> p_date_field   END
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (f.data -> '_tx' -> 'f') ? p_field_key
     AND (p_after_id IS NULL OR f.id > p_after_id)
   ORDER BY f.id
   OFFSET CASE WHEN p_after_id IS NULL THEN p_offset ELSE 0 END
   LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION taxonomy_rows_for_field(uuid, text, text, text, int, int, bigint) TO service_role;

-- ── 2. dataset_rows_pending_field_taxonomy (sql/151, blob-only since sql/152) ─

DROP FUNCTION IF EXISTS dataset_rows_pending_field_taxonomy(uuid, text, text[], int);

CREATE OR REPLACE FUNCTION dataset_rows_pending_field_taxonomy(
  p_dataset_id uuid,
  p_field_key  text,
  p_fields     text[],
  p_limit      int    DEFAULT 1000,
  p_after_id   bigint DEFAULT NULL
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (p_after_id IS NULL OR f.id > p_after_id)
     AND NOT ((f.data -> '_tx' -> 'f') ? p_field_key)
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   -- legacy calls keep row_index order; keyset calls page by id
   ORDER BY CASE WHEN p_after_id IS NULL THEN f.row_index END, f.id
   LIMIT p_limit;
$$;

COMMIT;

-- Verify
SELECT 'taxonomy_rows_for_field' AS object,
       CASE WHEN to_regprocedure('public.taxonomy_rows_for_field(uuid,text,text,text,int,int,bigint)') IS NOT NULL
             AND to_regprocedure('public.taxonomy_rows_for_field(uuid,text,text,text,int,int)') IS NULL
            THEN 'ready' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'dataset_rows_pending_field_taxonomy',
       CASE WHEN to_regprocedure('public.dataset_rows_pending_field_taxonomy(uuid,text,text[],int,bigint)') IS NOT NULL
             AND to_regprocedure('public.dataset_rows_pending_field_taxonomy(uuid,text,text[],int)') IS NULL
            THEN 'ready' ELSE 'MISSING' END;
