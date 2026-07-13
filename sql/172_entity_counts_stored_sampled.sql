-- sql/172_entity_counts_stored_sampled.sql
-- Brief E item 1 (PERFORMANCE_REVIEW.md §7 / §2) — the `entities` GET's live
-- FTS counts. `getEntitiesWithCounts` calls `count_entity_terms` on EVERY read
-- (Schema tab, theme cards, Ask Ana — entities are deliberately not
-- client-cached) to attach a live `mentions` count per catalog entity. At ~1M
-- rows that RPC 57014s: common terms match hundreds of thousands of rows via
-- the GIN `tsv` prefilter, and counting those (× up to ~300 catalog terms) blows
-- the 8s statement timeout (measured: 15 common terms alone 57014 at 1M).
--
-- Two-part fix, mirroring the sampled doctrine used everywhere else:
--
--  (A) STORED counts. Four columns on entity_catalog cache the computed count
--      per row, keyed by the scope's total row count (the same
--      `datasets.row_count` keying signal-stats uses). A default read (no theme,
--      no field scoping) serves the stored value with ZERO scans; it recomputes
--      + re-stores in the BACKGROUND only when the row total moved (append) or a
--      row is unpopulated (new manual entity / first read). Discovery + manual
--      add both re-store at the end since they already rebuild the catalog.
--
--  (B) SAMPLED compute at scale. `sampled_count_entity_terms` keyset-pages the
--      deterministic 50K `idx_drf_sample` (sql/160) for ONE dataset and matches
--      terms per page — the same tsv-prefilter + open-ended recheck as
--      count_entity_terms (sql/070), just bounded to the sample so it never
--      57014s. The caller (lib/entityFilter.ts) pages to the cap, scales counts
--      by total/scanned, and flags them "~". Below the 50K cap the walk reaches
--      every row = EXACT. Used for single-dataset scope above the cap; collection
--      scope (many small member datasets, not 1M-row members) keeps the live
--      count_entity_terms path.
--
-- SECURITY DEFINER over raw row data -> service_role only, same posture as
-- count_entity_terms (sql/070) and the sql/160/162/169/171 sampled family.

BEGIN;

-- (A) stored-count cache columns (nullable = not yet computed) -----------------
ALTER TABLE entity_catalog
  ADD COLUMN IF NOT EXISTS mention_count           integer,
  ADD COLUMN IF NOT EXISTS mention_count_sampled   boolean,
  ADD COLUMN IF NOT EXISTS mention_count_row_total bigint,
  ADD COLUMN IF NOT EXISTS mention_count_at        timestamptz;

COMMENT ON COLUMN entity_catalog.mention_count IS
  'Cached live full-text mention count (entity mentions across the scope''s open-ended fields), served by getEntitiesWithCounts default reads. NULL = not yet computed. Keyed by mention_count_row_total; recomputed in the background when the scope row total changes. sql/172.';
COMMENT ON COLUMN entity_catalog.mention_count_sampled IS
  'TRUE when mention_count was estimated over the 50K idx_drf_sample and scaled (dataset above the cap) — the UI shows a "~". sql/172.';
COMMENT ON COLUMN entity_catalog.mention_count_row_total IS
  'Scope total row count when mention_count was written (staleness key, mirrors signal-stats row_count keying). sql/172.';

-- (B) sampled_count_entity_terms — single-dataset keyset page over the sample --
CREATE OR REPLACE FUNCTION sampled_count_entity_terms(
  p_dataset_id  uuid,
  p_terms       text[],
  p_theme_query text,
  p_text_fields text[],
  p_after_hash  bigint,
  p_after_id    bigint,
  p_limit       int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.tsv, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  matched AS (
    SELECT t.term, count(*)::bigint AS n
    FROM unnest(p_terms) AS t(term)
    JOIN page
      ON page.tsv @@ websearch_to_tsquery('english', t.term)          -- tsv prefilter (matches count_entity_terms)
     AND (
       p_text_fields IS NULL
       OR to_tsvector('english', COALESCE(
            (SELECT string_agg(page.data ->> fld, ' ') FROM unnest(p_text_fields) AS fld), '')
          ) @@ websearch_to_tsquery('english', t.term)               -- exact recheck: open-ended fields only
     )
     AND (
       p_theme_query IS NULL
       OR page.tsv @@ websearch_to_tsquery('english', p_theme_query)  -- theme keywords stay on the full row
     )
    GROUP BY t.term
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'counts',    COALESCE((SELECT jsonb_agg(jsonb_build_array(term, n)) FROM matched), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION sampled_count_entity_terms(uuid, text[], text, text[], bigint, bigint, int) IS
  'Sampled twin of count_entity_terms (sql/070) for ONE dataset — keyset-pages the 50K idx_drf_sample and matches terms per page (same tsv-prefilter + open-ended recheck) so entity counts never 57014 at 1M. Caller pages to the cap + scales by total/scanned. sql/172.';

REVOKE ALL ON FUNCTION public.sampled_count_entity_terms(uuid, text[], text, text[], bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_count_entity_terms(uuid, text[], text, text[], bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_count_entity_terms(uuid, text[], text, text[], bigint, bigint, int) TO service_role;

-- (A cont.) batched writer — one round-trip to store the computed counts back
-- onto the catalog rows (p_counts = { "<slug>": <count>, ... }). --------------
CREATE OR REPLACE FUNCTION apply_entity_mention_counts(
  p_scope_type text,
  p_scope_id   uuid,
  p_row_total  bigint,
  p_sampled    boolean,
  p_counts     jsonb
)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH upd AS (
    UPDATE entity_catalog ec
    SET mention_count           = (p_counts ->> ec.slug)::int,
        mention_count_sampled   = p_sampled,
        mention_count_row_total = p_row_total,
        mention_count_at        = now()
    FROM jsonb_object_keys(p_counts) AS k(slug)
    WHERE ec.scope_type = p_scope_type
      AND ec.scope_id   = p_scope_id
      AND ec.slug       = k.slug
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;

COMMENT ON FUNCTION apply_entity_mention_counts(text, uuid, bigint, boolean, jsonb) IS
  'Batched write of getEntitiesWithCounts'' computed mention counts back onto entity_catalog (keyed by slug), with the scope row-total staleness key. sql/172.';

REVOKE ALL ON FUNCTION public.apply_entity_mention_counts(text, uuid, bigint, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_entity_mention_counts(text, uuid, bigint, boolean, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_entity_mention_counts(text, uuid, bigint, boolean, jsonb) TO service_role;

COMMIT;
