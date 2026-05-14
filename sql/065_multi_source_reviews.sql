-- 065: multi-source review sources — add platform discriminator
--
-- review_sources.source records which review platform a source pulls from.
-- Every existing row is Google, so the column defaults to 'google'. The
-- per-location place_id column is reused per-platform: Google place_id for
-- Google, Tripadvisor url_path for Tripadvisor.
--
-- No new tables — RLS is unchanged.

ALTER TABLE review_sources
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'google'
  CHECK (source IN ('google', 'tripadvisor'));
