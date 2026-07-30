-- sql/185_recordings_share_audio.sql
--
-- Per-meeting opt-in for exposing the stitched meeting audio on the public
-- share link (/th/[token]).
--
-- The public report is being widened to full parity with the internal report
-- (docs/RECORDINGS.md §7.2), which makes timestamps click-to-play. Audio is a
-- categorically bigger disclosure than the written report — it publishes
-- residents' actual voices to anyone holding the link — so it is NOT implied by
-- share_enabled. It is its own flag, defaults FALSE, and every existing shared
-- meeting therefore stays audio-less until someone deliberately turns it on.
--
-- Mirrors the share_verbatim pattern: written only when the caller includes the
-- key, so toggling the link on/off never clobbers the audio choice.

BEGIN;

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS share_audio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recordings.share_audio IS
  'Public-share opt-in for the stitched meeting audio. When false (default), /api/th/[token]/audio refuses even for a valid, enabled share token. Independent of share_enabled: publishing the written report never implies publishing the recording.';

COMMIT;
