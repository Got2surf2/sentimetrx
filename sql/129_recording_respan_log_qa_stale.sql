-- 129_recording_respan_log_qa_stale.sql
-- ============================================================
-- Span re-transcribe bookkeeping for the Town Hall coverage tab.
--
-- `respan_log`: append-only record of targeted span re-transcribes — which time
-- ranges were redone, with which ASR vendor, and when. Lets the Coverage tab
-- mark a quiet stretch as already re-extracted (with the vendor) so the user
-- doesn't repeat the (paid) pass. Reset to [] on a full re-transcribe, since a
-- fresh full pass overwrites the whole transcript and supersedes the spans.
--
-- `qa_stale`: the transcript changed (a span re-transcribe folded in recovered
-- speech) but the Q&A pairs were NOT re-extracted, so they no longer reflect the
-- transcript. The report shows a "re-run analysis" indicator while true.
-- Cleared (false) whenever the Q&A pass runs (runAnalyze post-Q&A write).
--
-- respan_log shape: [{"start_sec":123,"end_sec":456,"vendor":"whisper","at":"<iso>"}]
-- ============================================================

BEGIN;

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS respan_log jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS qa_stale boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recordings.respan_log IS
  'Append-only log of targeted span re-transcribes: [{start_sec,end_sec,vendor,at}]. Reset to [] on a full re-transcribe. Drives the Coverage tab "already re-extracted" marker.';
COMMENT ON COLUMN public.recordings.qa_stale IS
  'True when the transcript changed (span re-transcribe) without a Q&A re-run, so the pairs are out of date. Cleared by the analyze pass.';

SELECT 'recordings.respan_log + qa_stale columns' AS object, 'ready' AS status;

COMMIT;
