-- sql/077_drop_is_superadmin.sql
-- Drop the users.is_superadmin column added in 076 — redundant with the
-- existing users.role column. Datanautix-internal gating now uses
-- role = 'platform_admin' everywhere (matches the existing
-- is_platform_admin() SQL helper in sql/001_schema.sql and the
-- platform_admin role used by the rest of the codebase).

BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS is_superadmin;

COMMIT;

SELECT 'is_superadmin removed',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name='users' AND column_name='is_superadmin')
            THEN 'ready' ELSE 'STILL PRESENT' END;
