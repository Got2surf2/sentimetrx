-- sql/068_backfill_response_timestamps.sql
-- One-off data backfill: historical partial survey responses had
-- completed_at = NULL.
--
-- Cause: the old app/api/respond/route.ts wrote completed_at = NULL on every
-- partial save and only stamped a timestamp on the final "complete" submit.
-- A survey that never sent a formal "complete" (abandoned, or the widget
-- didn't fire it) kept its full payload but no date column — so it didn't
-- sort or date-filter in any dashboard.
--
-- The submission time was always captured inside payload.timestamp, so
-- completed_at is recoverable. As of this change respond/route.ts stamps
-- completed_at on every save, so no new NULL rows are created — this only
-- fixes the ~50 historical rows.

UPDATE public.responses
SET completed_at = (payload->>'timestamp')::timestamptz
WHERE completed_at IS NULL
  AND payload ? 'timestamp'
  AND (payload->>'timestamp') ~ '^\d{4}-\d{2}-\d{2}T';

-- Verify: still_null should be 0 (or only rows with no recoverable timestamp).
SELECT
  count(*) FILTER (WHERE completed_at IS NULL)                           AS still_null,
  count(*) FILTER (WHERE completed_at IS NULL AND payload ? 'timestamp') AS still_null_recoverable
FROM public.responses;
