-- 123_recording_capture_stereo.sql
--
-- Intent flag for a DELIBERATE stereo (split-mic) live capture. The live recorder
-- sets this true when getUserMedia delivered a 2-channel track (RØDE Split, etc.).
--
-- Why separate from audio_channels (sql/122): audio_channels is what extract.ts
-- *detected* from the file; capture_stereo is what the client *intended*. For an
-- intended split-mic capture, extract trusts it and preserves both channels
-- WITHOUT running the L−R "dual-mono" guard — that guard exists to stop phone /
-- camera dual-mono *uploads* from faking a 2nd speaker, but it is content-
-- dependent and can wrongly collapse a genuine 2-mic recording when the two mics
-- are correlated. NULL/false = uploads & mono → keep the auto-detect + guard path.

BEGIN;

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS capture_stereo boolean;

COMMENT ON COLUMN recordings.capture_stereo IS
  'TRUE when the live recorder deliberately captured a 2-channel split-mic source. extract.ts then preserves stereo if the file has ≥2 channels, skipping the dual-mono guard. Set by the live capture client.';

COMMIT;
