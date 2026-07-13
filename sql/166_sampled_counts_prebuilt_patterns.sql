-- sql/166_sampled_counts_prebuilt_patterns.sql
-- sampled_signal_counts accepts prebuilt regex patterns (2026-07-13).
--
-- WHY: theme-keyword matching semantics now live in ONE place —
-- lib/themeUtils.kwPatternFragment — which builds a POSIX-safe fragment per
-- keyword (single words: lemma alternation + stem suffix; multi-word
-- phrases: words in order with up to 4 intervening words). The other
-- counting RPCs (count_theme_matches / theme_dimension_counts /
-- compute_theme_cooccurrence_matrix) splice caller-supplied strings
-- unescaped into their \m(…) alternation, so they take the fragments with
-- NO schema change. This RPC was the one exception: it regex-escaped each
-- keyword internally, which would mangle a prebuilt fragment. Each theme
-- element may now carry "patterns" (the canonical fragments) alongside
-- "keywords"; when present they are used verbatim, otherwise the legacy
-- escaped-keyword build runs — so deployed pre-166 code and a post-166
-- database (or vice versa) keep working during the rollout window.
--
-- Context: the old exact-adjacency phrase matching left 63 of 105 AI-mined
-- keywords matching ≤1 of 3,000 Carrabba's GSS "Liked Least" comments —
-- the "Diffuse 12%" theme-fit the owner flagged. Same-commit code change
-- adds mine-time corpus validation; this migration keeps the sampled strip
-- counting with the same patterns as every other surface.

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_signal_counts(
  p_dataset_id  uuid,
  p_field_keys  text[],
  p_themes      jsonb,     -- [{"keywords": [...], "patterns": [...]}, ...] (order preserved in output)
  p_after_hash  bigint,    -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int        -- rows in this page
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- MATERIALIZED is load-bearing on pats/page/hits: single-referenced CTEs get
  -- inlined (PG12+), which re-built every theme's regex pattern once per
  -- (row x theme) — ~380ms of string_agg per 2K-row page (measured) — and
  -- would re-walk the sample index per consumer. Materialize = build patterns
  -- once, fetch the page once, evaluate each regex once per (row, theme).
  WITH pats AS MATERIALIZED (
    SELECT t.ord,
           CASE WHEN t.elem ? 'patterns' THEN
             -- Prebuilt canonical fragments (lib/themeUtils.kwPatternFragment),
             -- used verbatim: each already carries its own \w* stem suffixes
             -- and word-gap quantifiers. Only the word-start anchor is added.
             (SELECT string_agg('(?:^|\W)(?:' || pat || ')', '|')
                FROM jsonb_array_elements_text(t.elem -> 'patterns') AS pat
               WHERE btrim(pat) <> '')
           ELSE
             -- Legacy build: escape each raw keyword, exact-adjacency phrases.
             (SELECT string_agg('(?:^|\W)' || regexp_replace(kw, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\w*', '|')
                FROM jsonb_array_elements_text(t.elem -> 'keywords') AS kw
               WHERE btrim(kw) <> '')
           END AS pattern
    FROM jsonb_array_elements(p_themes) WITH ORDINALITY AS t(elem, ord)
  ),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  rec AS (
    -- per-field non-empty counts, aligned to p_field_keys order
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS records
    FROM (
      SELECT fk.ord,
             count(*) FILTER (WHERE NULLIF(btrim(p.data ->> fk.fld), '') IS NOT NULL) AS cnt
      FROM unnest(p_field_keys) WITH ORDINALITY AS fk(fld, ord)
      LEFT JOIN page p ON true
      GROUP BY fk.ord
    ) r
  ),
  hits AS MATERIALIZED (
    -- one boolean per (row, theme): does the row match the theme in any field?
    SELECT p.id, pt.ord,
           (pt.pattern IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(p_field_keys) AS fld
              WHERE p.data ->> fld IS NOT NULL AND p.data ->> fld ~* pt.pattern
           )) AS hit
    FROM page p CROSS JOIN pats pt
  ),
  theme_counts AS (
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS theme_counts
    FROM (SELECT ord, count(*) FILTER (WHERE hit) AS cnt FROM hits GROUP BY ord) t
  ),
  union_cnt AS (
    SELECT count(*) AS union_count
    FROM (SELECT id FROM hits WHERE hit GROUP BY id) u
  )
  SELECT jsonb_build_object(
    'n',            (SELECT count(*) FROM page),
    'records',      (SELECT records      FROM rec),
    'theme_counts', (SELECT theme_counts FROM theme_counts),
    'union_count',  (SELECT union_count  FROM union_cnt),
    'last_hash',    (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',      (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED signal counts over the deterministic idx_drf_sample order (same sample as sample_dataset_rows, sql/160). Theme elements may carry prebuilt "patterns" (lib/themeUtils.kwPatternFragment — canonical matching semantics, sql/166) used verbatim; falls back to the legacy escaped-keyword build when absent. Returns {n, records, theme_counts, union_count, last_hash, last_id}. Used above the 50K cap; callers scale to total rows and label results as sampled.';

REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) TO service_role;

COMMIT;
