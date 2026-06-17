-- 128_recording_speaker_names.sql
-- ============================================================
-- Human names for diarized speaker labels on a Town Hall transcript.
--
-- ASR diarization emits generic labels ("Speaker 0", "S1", …). This column
-- maps each label → a human name, set by the owner/admin in the report's
-- Transcript tab, and applied across the transcript view + Q&A. Distinct from
-- `channel_labels` (which names the two STEREO mics by channel index); this
-- covers the mono voice-cluster case where channels don't apply.
--
-- Shape: { "<diarized label>": "<name>", ... } e.g. {"Speaker 0":"Dr. Hatem"}.
-- ============================================================

ALTER TABLE public.recordings ADD COLUMN IF NOT EXISTS speaker_names jsonb;

COMMENT ON COLUMN public.recordings.speaker_names IS
  'Map of diarized speaker label (e.g. "Speaker 0" / "S1") -> human name, for the transcript/report. Set via /api/recordings/[id]/speaker-names. Distinct from channel_labels (stereo per-mic names).';

SELECT 'recordings.speaker_names column' AS object, 'ready' AS status;
