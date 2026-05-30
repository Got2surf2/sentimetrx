-- 091_recordings_storage_bucket.sql
--
-- Private bucket for recording source files + extracted/stitched audio +
-- generated PDF reports.
--
-- Path convention: <org_id>/<recording_id>/<filename>
--   <filename> = original upload name for source media
--                'audio/<original_name>.mp3' for ffmpeg-extracted audio
--                'audio/stitched.mp3' for the stitched multi-file output
--                'report.pdf' for the generated PDF report
--
-- Public report consumers hit /r/<shareToken> — that route reads via service
-- role and serves the HTML directly; it does NOT need the public-bucket flag.
-- PDF downloads are also served via short-TTL signed URLs from the server.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recordings',
  'recordings',
  false,                                                       -- private; access via signed URLs
  21474836480,                                                 -- 20 GB soft sanity cap per file
  ARRAY[
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
    'audio/ogg', 'audio/webm', 'audio/flac',
    'application/pdf', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Org-scoped read: any authenticated user can SELECT objects whose first
-- path segment matches their org_id. Service-role bypasses RLS, so workers
-- and signed-URL minting are unaffected.
DROP POLICY IF EXISTS "recordings bucket org read" ON storage.objects;
CREATE POLICY "recordings bucket org read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (
      SELECT org_id::text FROM public.users WHERE id = auth.uid()
    )
  );

-- Org-scoped insert: chunked direct browser uploads from the wizard go via
-- Supabase's TUS endpoint, which writes as the authenticated user. Restrict
-- to the caller's org folder.
DROP POLICY IF EXISTS "recordings bucket org insert" ON storage.objects;
CREATE POLICY "recordings bucket org insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (
      SELECT org_id::text FROM public.users WHERE id = auth.uid()
    )
  );

-- Org-scoped update + delete: in practice writes happen via service role,
-- but allowing the owner org to clean up on cancellation keeps the path open
-- and is no weaker than read access. Cross-org access remains denied.
DROP POLICY IF EXISTS "recordings bucket org update" ON storage.objects;
CREATE POLICY "recordings bucket org update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (
      SELECT org_id::text FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "recordings bucket org delete" ON storage.objects;
CREATE POLICY "recordings bucket org delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (
      SELECT org_id::text FROM public.users WHERE id = auth.uid()
    )
  );
