-- 097_recordings_meeting_tool.sql
--
-- Generalizes Recordings from a Q&A recorder into a configurable meeting tool:
-- record a whole meeting, split the PRESENTATION phase from the Q&A phase,
-- summarize each. Adds:
--   meeting_profile      — the meeting-type preset + ordered phases + tunable params
--   phase_map            — detected (and user-edited) phase spans over the transcript
--   presentation_outline — AI-vision read of the presenter's uploaded slide deck
--   proceedings_summary  — neutral summary of the presentation phase (seeded by slides)
--   recording_files.file_role — distinguishes audio/video media from an uploaded slide deck
--
-- All four recordings columns are nullable adds on an already-RLS-enabled table,
-- so existing recordings_org_read/write policies cover them — no new policy. A
-- recording with meeting_profile IS NULL behaves exactly as the current Q&A flow.
-- Slide PNGs live under the existing `recordings` bucket path, covered by its
-- existing storage policy.

BEGIN;

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS meeting_profile      jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS phase_map            jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS presentation_outline jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS proceedings_summary  jsonb;

COMMENT ON COLUMN recordings.meeting_profile IS
  'Meeting-type config (docs/RECORDINGS.md): { preset_id, phases:[{kind,label,analysis,expected}], has_slides }. NULL = the implicit town_hall_qa preset (single Q&A phase over the whole transcript) = legacy behavior.';
COMMENT ON COLUMN recordings.phase_map IS
  'Detected + user-edited meeting phases: { phases:[{kind,label,start_sec,end_sec,confidence?}], detected_at, model, edited_by_user }. Computed post-transcription, adjustable at the transcribed review gate. NULL/absent => whole transcript treated as one Q&A phase.';
COMMENT ON COLUMN recordings.presentation_outline IS
  'AI-vision read of the uploaded slide deck (file_role=slides): { slides:[{slide_number,title,key_points,figures,presenter,notes}], source_filename, page_count, generated_at, model }. Ground-truth seed for proceedings_summary. NULL when no slides uploaded or vision unavailable.';
COMMENT ON COLUMN recordings.proceedings_summary IS
  'Neutral summary of the presentation phase (docs/RECORDINGS.md): { overview, items:[{title,presenter,what_was_presented,key_figures,slide_refs}], generated_at, model }. NULL for Q&A-only meetings or on graceful-degrade.';

ALTER TABLE recording_files ADD COLUMN IF NOT EXISTS file_role text NOT NULL DEFAULT 'media'
  CHECK (file_role IN ('media', 'slides'));

COMMENT ON COLUMN recording_files.file_role IS
  'media = audio/video processed by the ffmpeg extract+transcribe pipeline; slides = an uploaded presentation deck (PDF in v1) read by AI vision, never sent to ffmpeg.';

COMMIT;
