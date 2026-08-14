-- sql/186_sample_dataset_rows_drop_keys.sql
-- Stop shipping fields nobody reads on the bulk-row path (2026-08-14).
--
-- WHY (measured on the 128,619-row Outback GuestLens dataset, TEST):
-- `/rows?all=true&sampleMax=50000` costs 21s warm / 36s cold. The breakdown is
-- ~0.9-1.2s of SERVER time per 5,000-row page (building a 9.5MB jsonb and
-- gzipping it) against only ~0.15-0.4s of transfer, so the lever is building a
-- smaller value — not moving it faster. Two things that were measured and
-- rejected first, recorded so they are not re-attempted:
--   * Parallel pages: concurrency 2/3/4 are all SLOWER than serial (29.6/25.1/
--     28.8s vs 20.9s) and concurrency 10 makes EVERY page hit the statement
--     timeout. Serial paging is already both the fastest and the safest.
--   * Columnar payload (one key header + value arrays): 4.0x smaller raw, but
--     only 1.4x gzipped — gzip already collapses the repeated question-sentence
--     keys — for ~80ms of parse. Not worth the invasiveness.
--
-- What actually pays: 14 of this dataset's 32 fields are marked `ignore` in the
-- schema, and EVERY analyze surface (TextMine, Charts, Stats, Snapshot,
-- FilteredCommentsPanel) already filters them out. They were serialized, gzipped,
-- transferred and parsed 50,000 times per load, then discarded client-side.
-- Dropping them here: 9.45MB -> 5.76MB per page (-39%), and the jsonb build gets
-- FASTER (803ms -> 309ms) because there is less to assemble.
--
-- This is also a data-minimisation fix, which is the more important half. The
-- ignored fields on that dataset are First Name, Last Name, Email Address, IP
-- Address, Transaction ID and DR Card Number_Member. They were being written
-- into a client-side payload — readable in devtools/view-source — for rows the
-- UI never renders. `_tx`/`_txv`/`_sub` (the embedded taxonomy blob) were
-- already stripped, but only in Node AFTER the transfer, so the DB->server leg
-- still carried them; they are stripped here now.
--
-- Deploy-order safety: `p_drop_keys` carries a DEFAULT and is appended last, so
-- a pre-deploy caller passing the original four arguments still resolves to this
-- function and behaves exactly as before (minus the reserved keys, which no
-- caller wanted). CREATE OR REPLACE cannot add a parameter, so this DROPs and
-- re-CREATEs inside the migration transaction — readers see the old or the new
-- definition, never neither. Same move sql/160 made when it retired sql/157's
-- signatures.
--
-- SECURITY DEFINER + service_role-only execution is preserved from sql/160: the
-- function returns raw row data and the route enforces org access before calling.

BEGIN;

DROP FUNCTION IF EXISTS public.sample_dataset_rows(uuid, bigint, bigint, int);

CREATE FUNCTION public.sample_dataset_rows(
  p_dataset_id  uuid,
  p_after_hash  bigint,   -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int,      -- rows in this page
  p_drop_keys   text[] DEFAULT '{}'  -- schema-ignored/hidden fields to omit
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS (
    SELECT f.id, f.row_index,
           -- Reserved keys are ALWAYS dropped (the route discarded them anyway,
           -- just one network leg later); caller-supplied keys on top of that.
           ((f.data - '_tx' - '_txv' - '_sub') - COALESCE(p_drop_keys, '{}'::text[])) AS data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'row_index', row_index, 'data', data) ORDER BY h, id),
      '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  ) FROM page;
$$;

COMMENT ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int, text[]) IS
  'O(sample) deterministic sampler for the rows route all=true >50K path. Returns the p_limit rows with the smallest uniform hash(id||dataset_id) after the (p_after_hash,p_after_id) keyset cursor, as {rows: jsonb[], last_hash, last_id}. Backed by idx_drf_sample -> index range scan touching only the ~cap sampled rows, so cost is independent of dataset size and appends participate automatically. Same rows -> same sample (deck credibility, ARCHITECTURE.md D6). sql/186: always strips the reserved _tx/_txv/_sub keys and additionally omits p_drop_keys (the schema''s ignore/hidden fields) so the DB->server leg stops carrying columns every analyze surface filters out — measured -39% payload on a 32-field survey, and it keeps PII-ish ignored columns (name/email/IP/card) out of the client payload entirely.';

REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int, text[]) TO service_role;

COMMIT;
