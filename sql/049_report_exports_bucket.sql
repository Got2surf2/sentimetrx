-- 049 — Storage bucket for shareable HTML report exports.
--
-- Private bucket. Access is via short-TTL signed URLs the server hands
-- back to the operator; no public-read policy. Service role inserts,
-- nothing else writes. Reads via signed URLs only (the link itself is
-- the capability — same model as the old S3-backed flow).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-exports',
  'report-exports',
  false,
  NULL,
  ARRAY['text/html', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;
