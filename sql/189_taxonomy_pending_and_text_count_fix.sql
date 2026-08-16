-- sql/189_taxonomy_pending_and_text_count_fix.sql
-- Two long-standing Dimensions bugs, found 2026-08-16 while fanning taxonomy
-- out to collection members. NEITHER is a collections bug — both affect every
-- dataset — which is why they get their own migration.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 1 — dataset_rows_with_text_count(uuid, text[]) IS NOT IN THE DATABASE.
--
-- sql/117 was written to drop the sql/114 single-field form and create this
-- multifield one. It was never applied: prod still carries the sql/114 scalar
-- dataset_rows_with_text_count(uuid, text) AND the 3-arg
-- dataset_rows_pending_field_taxonomy(uuid, text, int) that 117 also dropped.
-- (The multifield PENDING signature exists only because sql/151 re-created it.)
--
-- So the array call the code has always made 404s with PGRST202, every caller
-- takes its "leave it undefined" fallback, and StoredTaxonomyField.rowsWithText
-- is undefined for EVERY dataset — the Dimensions header silently reads
-- classifiedRows instead of the rows-with-text denominator it claims to show.
-- No re-classify is needed after this lands: the Dimensions GET recomputes the
-- denominator live whenever the stored entry lacks it, so it self-heals.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 2 — dataset_rows_pending_field_taxonomy MISSES ROWS WITH NO `_tx` AT ALL.
--
--   AND NOT ((f.data -> '_tx' -> 'f') ? p_field_key)
--
-- The jsonb `?` operator is STRICT. On a row with no `_tx` key, `data -> '_tx'`
-- is SQL NULL, so the whole test is NULL, `NOT NULL` is NULL, and WHERE drops
-- the row. A row is therefore only ever "pending" if it ALREADY has a `_tx`
-- block missing this one field key.
--
-- But a never-classified row — and every freshly-synced review — has no `_tx`
-- at all. So the pendingOnly auto-classify path has been a silent no-op on
-- exactly the rows it exists to serve:
--   * reviewSync's safety net (lib/reviewSync.ts) — newly synced reviews have
--     been INVISIBLE to Dimensions until someone ran a manual full re-classify;
--   * autoEnableDimensions / autoTagEmotion (TextMineModule) — the automatic
--     post-mining classify reported "done" having classified nothing.
-- The manual "Enable Dimensions" button was unaffected (it runs the full
-- classifier, which pages rows directly and never consults this RPC), which is
-- why the feature looked like it worked.
--
-- Proved on TEST 2026-08-16: strip `_tx` entirely -> the row is invisible to
-- this RPC; leave `_tx` with an empty `f` -> the same row is returned.
-- COALESCE(..., false) is the whole fix.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ALSO: both functions were EXECUTABLE BY `anon`.
--
-- They are SECURITY DEFINER over raw tenant rows, so they bypass RLS. Verified
-- on TEST 2026-08-16 with nothing but the PUBLIC anon key (the one shipped in
-- every browser bundle) and an arbitrary dataset_id: the count function
-- returned a live row count for another tenant's dataset, and the pending
-- function returned a full raw row — review text, author name, location, the
-- lot. Both are called ONLY with the service-role client (the taxonomy route,
-- lib/taxonomyRollup, lib/reviewSync), and this codebase makes no browser-side
-- RPC calls at all, so locking them to service_role costs nothing. Same posture
-- sql/180 already documents for their sibling dataset_rows_with_substantive_count.
--
-- ⚠️ THIS IS THE TIP OF A CLASS: 54 of the 86 SECURITY DEFINER functions in
-- `public` are anon-executable, 30 of which read dataset_rows_flat — including
-- writes (apply_taxonomy_verdicts), destructive ops (archive_dataset,
-- restore_dataset), a cross-org mutation (transfer_recording_org) and raw-row
-- readers (get_rows_by_filters, search_dataset_rows, taxonomy_drill_rows).
-- That sweep is NOT in this migration: it needs its own audit of which routes
-- use the cookie-auth client vs the service-role client, so it can revoke
-- `authenticated` safely too. Tracked separately — do not consider it done.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Deploy-order safe in BOTH directions. Bug 1: no deployed caller works today
-- (they all 404 into a fallback), so creating the function can only improve
-- them. Bug 2: the signature is unchanged — only which rows it returns moves.
-- The dropped overloads are callerless AND already broken (they LEFT JOIN the
-- sidecar tables sql/152 dropped, so calling them errors). Dropping the shadow
-- overload also removes a footgun: PostgREST picks an overload by the argument
-- NAMES sent, so a p_field/p_limit call resolves to the broken one.

BEGIN;

-- ── 1. Multifield "rows with text" denominator (sql/117's intent, finally) ───

DROP FUNCTION IF EXISTS dataset_rows_with_text_count(uuid, text);

CREATE OR REPLACE FUNCTION dataset_rows_with_text_count(
  p_dataset_id uuid,
  p_fields     text[]
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     -- Same "has real text" test as the classifier (strip whitespace + control
     -- chars), so this denominator == the rows the classifier actually tags.
     -- A plain btrim would count tab/newline-only rows as text and leave them
     -- permanently "untagged".
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     );
$$;

COMMENT ON FUNCTION dataset_rows_with_text_count(uuid, text[]) IS
  'Rows with real text in ANY of the selected fields — the "N rows with text" denominator the Dimensions header reconciles against. Written for sql/117 but actually created only in sql/189 (117 was never applied), which is why rowsWithText was undefined on every dataset until then. Twin of dataset_rows_with_substantive_count (sql/180).';

REVOKE ALL ON FUNCTION dataset_rows_with_text_count(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION dataset_rows_with_text_count(uuid, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION dataset_rows_with_text_count(uuid, text[]) TO service_role;

-- ── 2. Pending rows: a MISSING _tx must count as "not yet classified" ────────

DROP FUNCTION IF EXISTS dataset_rows_pending_field_taxonomy(uuid, text, int);

CREATE OR REPLACE FUNCTION dataset_rows_pending_field_taxonomy(
  p_dataset_id uuid,
  p_field_key  text,
  p_fields     text[],
  p_limit      int DEFAULT 1000,
  p_after_id   bigint DEFAULT NULL
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (p_after_id IS NULL OR f.id > p_after_id)
     -- COALESCE is load-bearing (sql/189). `?` is STRICT, so on a row with no
     -- `_tx` key the test is NULL and `NOT NULL` silently drops it — which made
     -- a never-classified dataset report ZERO pending rows.
     AND NOT COALESCE((f.data -> '_tx' -> 'f') ? p_field_key, false)
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   -- legacy calls keep row_index order; keyset calls page by id (sql/155)
   ORDER BY CASE WHEN p_after_id IS NULL THEN f.row_index END, f.id
   LIMIT p_limit;
$$;

COMMENT ON FUNCTION dataset_rows_pending_field_taxonomy(uuid, text, text[], int, bigint) IS
  'Rows with text in any selected field that lack an embedded taxonomy block for the combined field key — drives the auto-classify safety net (reviewSync, autoEnableDimensions) and the "classify the new rows" drift nudge. sql/189 made a MISSING _tx count as pending (the strict jsonb ? operator returned NULL, so never-classified and freshly-synced rows were invisible) and locked execution to service_role.';

REVOKE ALL ON FUNCTION dataset_rows_pending_field_taxonomy(uuid, text, text[], int, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION dataset_rows_pending_field_taxonomy(uuid, text, text[], int, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION dataset_rows_pending_field_taxonomy(uuid, text, text[], int, bigint) TO service_role;

COMMIT;
