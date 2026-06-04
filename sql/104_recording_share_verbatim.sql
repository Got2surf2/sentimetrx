-- sql/104_recording_share_verbatim.sql
-- Owner control over what the public share link (/th/[token]) shows for each
-- Q&A answer: the editorial "polished" version (default) or the verbatim words
-- spoken (docs/RECORDINGS.md §4.6). The meeting transcript stays private either
-- way — this only swaps polished vs verbatim on the Q&A pairs already shown.
-- FALSE = polished (with per-pair verbatim fallback), the existing behavior.

BEGIN;

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS share_verbatim BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
