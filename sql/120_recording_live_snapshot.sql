-- 120_recording_live_snapshot.sql
-- Town Hall live in-person capture (§ 15, deferred item 2). Persist the live
-- transcript + latest rolling summary on the recording so that hitting Stop
-- shows an instant provisional recap while the batch pipeline runs, and so the
-- live transcript survives a tab crash. Both nullable + additive; the columns
-- inherit the table's existing RLS. The authoritative report still comes from
-- the batch pipeline (analysis_summary), NOT from these.

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS live_summary jsonb,
  ADD COLUMN IF NOT EXISTS live_transcript text;
