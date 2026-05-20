-- sql/076_users_superadmin.sql
-- Per-user superadmin flag. Separate from organizations.is_admin_org (which
-- distinguishes org-tier admins from tenant users) — this flag identifies
-- Datanautix-internal users who can access Datanautix-only product surfaces
-- like "include AI labels in this share for a prospect demo".
--
-- Why per-user not per-org: Datanautix and Datanautix Demo both currently
-- carry is_admin_org=true. Demo users should NOT inherit superadmin rights
-- just because their org has the admin flag. Per-user also survives org
-- reorgs and lets us grant temporary superadmin without spinning up a new
-- org.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

-- Seed the bootstrap user. Any future grants happen via direct UPDATE.
UPDATE users SET is_superadmin = true
WHERE email = 'got2surf2@gmail.com';

COMMIT;

-- Sanity check
SELECT 'is_superadmin column',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='users' AND column_name='is_superadmin')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'seed user flagged',
       CASE WHEN EXISTS (SELECT 1 FROM users WHERE email='got2surf2@gmail.com' AND is_superadmin = true)
            THEN 'ready' ELSE 'MISSING' END;
