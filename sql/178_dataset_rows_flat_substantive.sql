-- sql/178_dataset_rows_flat_substantive.sql
-- Substantive/"usefulness" flag — stored per comment at ingest.
--
-- The TextMine insight surfaces (mining corpus, theme-fit denominator, word
-- clouds, the dataset-level "% substantive" readout) should count only comments
-- that carry real feedback — not "N/A" / "Nothing" / "all good". The canonical
-- test is lib/usefulness.ts `scoreUsefulness` (v1 = isSubstantiveText: >=5 words,
-- or >=4 words with an everyday function word). Rather than recompute that rule
-- per query (JS↔SQL drift), we STORE the verdict per comment and read a cheap
-- boolean everywhere.
--
--  * `substantive` jsonb — map of field-name -> true for every field whose value
--    scored substantive. ONLY true keys are stored, so the blob stays tiny (IDs,
--    ratings, "N/A" answers never get a key). It is stamped over ALL non-`_`
--    fields present in `data`, which makes the flag a pure function of the row —
--    no schema needed at ingest, and a field later re-classified as open-ended
--    already carries its key (no restamp on schema edits). A count filters one
--    open-ended field key at a time (`substantive ? 'LEAST'`), so extra keys for
--    non-open fields are inert.
--  * `substantive_v` smallint — the scorer version (USEFULNESS_VERSION) that
--    stamped the row. A later v2 (an LLM "actionable feedback?" judgment) bumps
--    the constant; a re-score backfill then finds stale rows via
--    `substantive_v IS NULL OR substantive_v < <current>` and recomputes them.
--
-- No index: the counts that filter by `substantive ? fld` already run inside the
-- deterministic-sample / keyset scans that bound by (dataset_id, row range), so
-- the has-key test is a cheap per-row check on rows already selected — a GIN on
-- the tiny map would not be pulled and is not worth the write cost.

BEGIN;

ALTER TABLE public.dataset_rows_flat
  ADD COLUMN IF NOT EXISTS substantive   jsonb,
  ADD COLUMN IF NOT EXISTS substantive_v smallint;

COMMENT ON COLUMN public.dataset_rows_flat.substantive IS
  'Map field-name -> true for every field whose value carries usable feedback (lib/usefulness.ts scoreUsefulness). Only true keys stored. Stamped at ingest + backfilled; read by the substantive-aware TextMine counts. sql/178.';
COMMENT ON COLUMN public.dataset_rows_flat.substantive_v IS
  'Scorer version (USEFULNESS_VERSION) that stamped `substantive`. NULL = not yet scored. A version bump lets a re-score backfill find stale rows. sql/178.';

-- Batched stamp/re-score writer (backfill + any future re-score pass). Mirrors
-- apply_taxonomy_verdicts (sql/151): service_role only, id paired with
-- p_dataset_id so a batch can never cross a dataset boundary. Writes only the
-- two flag columns — the tsv trigger is `UPDATE OF data`, so it does NOT fire.
CREATE OR REPLACE FUNCTION apply_substantive_flags(
  p_dataset_id uuid,
  p_items      jsonb
)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH items AS (
    SELECT (it ->> 'id')::bigint AS id,
           it -> 's'             AS s,
           (it ->> 'v')::smallint AS v
      FROM jsonb_array_elements(p_items) AS it
  ),
  updated AS (
    UPDATE dataset_rows_flat f
       SET substantive   = i.s,
           substantive_v = i.v
      FROM items i
     WHERE f.id = i.id
       AND f.dataset_id = p_dataset_id
    RETURNING f.id
  )
  SELECT count(*) FROM updated;
$$;

GRANT EXECUTE ON FUNCTION apply_substantive_flags(uuid, jsonb) TO service_role;

COMMIT;
