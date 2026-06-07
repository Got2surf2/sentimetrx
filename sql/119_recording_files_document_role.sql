-- 119_recording_files_document_role.sql
-- Edit-anytime / documents: add 'document' to recording_files.file_role.
--
-- file_role meanings:
--   media    — audio/video, transcribed (the recording)
--   slides   — the presentation deck (PDF), AI-vision-read → presentation_outline
--   document — a brief/agenda/other reference doc attached to the project; stored
--              for reference + setup pre-fill; the pipeline does NOT process it.
--
-- sql/097 created file_role with CHECK (media|slides) as an inline column
-- constraint (named recording_files_file_role_check). Drop + re-add to widen it.

BEGIN;

ALTER TABLE recording_files DROP CONSTRAINT IF EXISTS recording_files_file_role_check;
ALTER TABLE recording_files ADD CONSTRAINT recording_files_file_role_check
  CHECK (file_role IN ('media', 'slides', 'document'));

COMMENT ON COLUMN recording_files.file_role IS
  'media = audio/video (transcribed); slides = presentation deck (PDF, vision-read → presentation_outline); document = brief/reference doc (stored, not pipeline-processed). Default media.';

COMMIT;
