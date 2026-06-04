-- sql/101_favorites_recording.sql
-- Extend user_favorites to allow Town Hall recordings as a favoritable
-- resource type. The original CHECK (sql/075) predates the Town Hall product;
-- the favorites star on the Town Hall list cards inserts resource_type
-- 'recording', which the old constraint rejects.
--
-- The inline CHECK in sql/075 is auto-named user_favorites_resource_type_check.
-- Drop + re-add with the extended value set.

BEGIN;

ALTER TABLE user_favorites
  DROP CONSTRAINT IF EXISTS user_favorites_resource_type_check;

ALTER TABLE user_favorites
  ADD CONSTRAINT user_favorites_resource_type_check
  CHECK (resource_type IN ('bot','study','dataset','campaign','townhall_session','recording'));

COMMIT;
