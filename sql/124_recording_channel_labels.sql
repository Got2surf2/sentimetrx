-- 124_recording_channel_labels.sql
--
-- Optional human names for the channels of a stereo (split-mic) capture, indexed
-- by channel: ["<left / Mic 1>", "<right / Mic 2>"]. e.g. ["Facilitator","Audience"].
-- Set in the Mic check when a 2-channel device is detected; the report shows the
-- name instead of the generic "Mic 1·L / Mic 2·R" on each transcript line.
-- NULL = unnamed (fall back to the generic mic labels).

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS channel_labels jsonb;

COMMENT ON COLUMN recordings.channel_labels IS
  'Optional names for stereo capture channels, indexed by channel: [leftName, rightName]. Shown in the report transcript in place of Mic 1·L / Mic 2·R. Set by the live capture Mic check.';
