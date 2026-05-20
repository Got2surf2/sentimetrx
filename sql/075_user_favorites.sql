-- sql/075_user_favorites.sql
-- Per-user favorites across the platform: bots, studies, datasets,
-- campaigns, townhall_sessions. Lets a user pin the handful of
-- resources they actually care about so the mobile (/m) page can
-- surface them above the "5 most-recent per section" view.
--
-- Per-user, NOT per-org: each user manages their own list. A user
-- inside an admin org could star resources from any org; the row only
-- carries (user_id, resource_type, resource_id) so cross-org admin
-- bookmarks work naturally.

BEGIN;

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('bot','study','dataset','campaign','townhall_session')),
  resource_id   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS user_favorites_user_type_created_idx
  ON user_favorites (user_id, resource_type, created_at DESC);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_favorites_self_read ON user_favorites;
CREATE POLICY user_favorites_self_read ON user_favorites
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_favorites_self_insert ON user_favorites;
CREATE POLICY user_favorites_self_insert ON user_favorites
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_favorites_self_delete ON user_favorites;
CREATE POLICY user_favorites_self_delete ON user_favorites
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;

-- Sanity check
SELECT 'user_favorites table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema='public' AND table_name='user_favorites')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'user_favorites_user_type_created_idx',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname='public' AND tablename='user_favorites'
                            AND indexname='user_favorites_user_type_created_idx')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'user_favorites RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables
                          WHERE schemaname='public' AND tablename='user_favorites' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END;
