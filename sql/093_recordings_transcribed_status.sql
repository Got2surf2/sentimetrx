-- 093_recordings_transcribed_status.sql
--
-- Gate 1: make the AI analysis pass on-demand. The pipeline now PAUSES after
-- transcription at a new stable status 'transcribed' instead of auto-running
-- the (~$1) Opus + Sonnet extraction. The user reviews the transcript, adjusts
-- setup (agenda / panel roster / instructions), then explicitly triggers
-- analysis via POST /api/recordings/[id]/analyze.
--
--   uploading → queued → extracting → transcribing → [transcribed] → analyzing → complete
--                                                          ↑ pause, awaiting user
--
-- 'transcribed' is a stable wait state, not active processing, so it's excluded
-- from the "active pipeline" partial index alongside the terminal states.

BEGIN;

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_status_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_status_check
  CHECK (status IN ('uploading', 'queued', 'extracting', 'transcribing',
                    'transcribed', 'analyzing', 'rendering', 'complete',
                    'failed', 'cancelled'));

DROP INDEX IF EXISTS recordings_status_active_idx;
CREATE INDEX IF NOT EXISTS recordings_status_active_idx
  ON recordings (status) WHERE status NOT IN ('transcribed', 'complete', 'failed', 'cancelled');

COMMIT;
