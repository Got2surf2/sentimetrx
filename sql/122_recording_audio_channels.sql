-- 122_recording_audio_channels.sql
--
-- Per-channel speaker separation for split-mic recordings (RØDE Wireless PRO in
-- "Split" mode → mic 1 on Left, mic 2 on Right; or any genuinely-stereo upload).
--
-- extract.ts detects the channel layout of the source audio and records it here:
--   1 = mono (single mix; diarization is voice-signature clustering)
--   2 = true stereo (each channel transcribed independently → channel = speaker)
-- Dual-mono sources (2 channels, identical content) are collapsed to 1 by extract.
--
-- transcribe.ts reads this to decide Deepgram's `multichannel` mode. NULL means
-- "not yet extracted" (legacy rows / in-flight) → treated as mono.

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS audio_channels smallint;

COMMENT ON COLUMN recordings.audio_channels IS
  'Detected channel layout of the extracted audio: 1=mono, 2=true stereo (per-channel speaker separation). NULL=not yet extracted. Set by lib/recordings/extract.ts.';
