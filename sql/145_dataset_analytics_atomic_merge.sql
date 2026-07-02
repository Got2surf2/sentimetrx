-- sql/145_dataset_analytics_atomic_merge.sql
-- Atomic top-level merge / key-delete for dataset_state.analytics.
--
-- `analytics` is a shared JSONB blob holding INDEPENDENT top-level keys written
-- by different code paths: `signal_stats` (lib/signalStats), plus `totalRows` /
-- `fieldSummaries` / `computedAt` (the compute route). Each writer used to read
-- the whole blob, spread it, and write it back — so two concurrent writers (e.g.
-- a signal-stats cache refresh while the compute route runs, or two viewers of
-- the same dataset) would read the same base object and last-write-wins, silently
-- dropping the other's keys.
--
-- These do the mutation server-side in one statement:
--   merge  → analytics = COALESCE(analytics,'{}') || patch   (top-level keys in
--            `patch` overwrite; every other key is preserved)
--   delete → analytics = COALESCE(analytics,'{}') - key
--
-- Additive: inert until the app calls them (lib/datasetAnalytics.ts).

BEGIN;

CREATE OR REPLACE FUNCTION merge_dataset_analytics(p_dataset_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE dataset_state
  SET analytics = COALESCE(analytics, '{}'::jsonb) || p_patch
  WHERE dataset_id = p_dataset_id;
$$;

CREATE OR REPLACE FUNCTION delete_dataset_analytics_key(p_dataset_id uuid, p_key text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE dataset_state
  SET analytics = COALESCE(analytics, '{}'::jsonb) - p_key
  WHERE dataset_id = p_dataset_id;
$$;

COMMENT ON FUNCTION merge_dataset_analytics(uuid, jsonb) IS
  'Atomically shallow-merges a patch into dataset_state.analytics (top-level keys), preserving keys not in the patch. Replaces a racy read-modify-write.';
COMMENT ON FUNCTION delete_dataset_analytics_key(uuid, text) IS
  'Atomically removes one top-level key from dataset_state.analytics. Replaces a racy read-modify-write.';

COMMIT;
