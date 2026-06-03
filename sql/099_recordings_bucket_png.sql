-- 099_recordings_bucket_png.sql
--
-- The meeting tool renders an uploaded slide deck (PDF) to one PNG per page in
-- a Vercel Sandbox and stores them under <org_id>/<recording_id>/slides/ for the
-- vision read. The `recordings` bucket's MIME allowlist (sql/091) didn't include
-- image/png, so those uploads 415'd. Add image/png (+ image/jpeg for safety).

BEGIN;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
  'audio/ogg', 'audio/webm', 'audio/flac',
  'application/pdf', 'application/octet-stream',
  'image/png', 'image/jpeg'
]
WHERE id = 'recordings';

COMMIT;
