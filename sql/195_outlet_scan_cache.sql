-- 195: persisted outlet-report scan (Advanced Analytics O(N)-per-click fix,
-- PERFORMANCE_REVIEW.md §8). lib/outletReport.loadScan stores the serialized
-- scan (per-outlet aggregates + a ~30 B/row digest, ~1-2 MB for a 40K-row
-- brand) here, keyed by a fingerprint of row_count + last_synced_at +
-- theme model + hierarchy designations + taxonomy rollup updatedAts — the
-- sql/194 filter_options pattern. Compute-on-miss; no writer besides loadScan.

BEGIN;

ALTER TABLE public.dataset_state ADD COLUMN IF NOT EXISTS outlet_scan_cache jsonb;

COMMENT ON COLUMN public.dataset_state.outlet_scan_cache IS
  'Persisted outlet-report scan (lib/outletScanCache PersistedScan v1): per-outlet aggregates + per-row digest, keyed by {fingerprint}. Written compute-on-miss by lib/outletReport.loadScan; safe to NULL at any time (next view recomputes).';

COMMIT;
