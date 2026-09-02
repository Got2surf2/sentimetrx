-- 198_data_stories.sql
-- Short, manageable share links for Data Stories.
--
-- The v1 story link was the raw storage signed-URL token (~340 chars) proxied
-- through /api/story — unsendable-looking, and its expiry is baked into the
-- signature so nothing about a sent link can ever be changed. This table makes
-- the link a first-class object: the SLUG is the capability (crypto-random
-- base62, ~59 bits — same trust model as question_batches.share_token), and
-- the row carries the lifecycle:
--   expires_at — extendable/shortenable AFTER a link is sent
--   revoked_at — kill one link from the UI without touching storage
-- The /story/[slug] viewer (service role) checks both, then streams the HTML
-- object from the private report-exports bucket. Deleting the storage object
-- remains the hard kill for every link to that story.

BEGIN;

CREATE TABLE IF NOT EXISTS data_stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  dataset_id   uuid NOT NULL,
  slug         text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 8 AND 32),
  title        text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

-- The hot read: the public viewer's slug lookup (UNIQUE already indexes slug).
-- Org listing for the future Share-tab management surface:
CREATE INDEX IF NOT EXISTS idx_data_stories_org
  ON data_stories (org_id, dataset_id, created_at DESC);

ALTER TABLE data_stories ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; the story-generation route (service role) stamps
-- org_id from the dataset it already org-gated, and the public viewer reads
-- by slug with the service role (the slug is the capability).
DROP POLICY IF EXISTS data_stories_org_read ON data_stories;
CREATE POLICY data_stories_org_read ON data_stories
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
