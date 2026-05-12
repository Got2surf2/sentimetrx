-- 053_shared_links_org_scoping.sql
--
-- Add org_id to `shared_links` so the table fits the standard
-- May-2026-lesson pattern: every org-scoped table carries org_id, and
-- service-role queries can pair (id, org_id) explicitly.
--
-- Framing note: this is DEFENSE-IN-DEPTH + CONSISTENCY, not a fix for
-- an active cross-tenant leak. As of 2026-05-12, every shared_links
-- access path in the app already enforces org isolation:
--   - POST /api/share         → gateShareTarget → resolveTargetOrgId
--     verifies user.org_id == target's org_id before INSERT
--   - GET  /api/share?token=  → lookup by 192-bit unique token; token IS
--     the access credential (same model as /s/[guid] widgets)
--   - GET  /api/share?list_…  → gateShareTarget runs before the
--     (type, target_id) query
--   - DELETE /api/share       → gateShareTarget on the resolved share's
--     target before deletion
--   - /shared/conversation/[token]/page.tsx — token-only access
--
-- This migration adds org_id so:
--   (a) future code paths can use .eq('org_id', orgId) as a second-layer
--       filter without having to JOIN through the target's parent table;
--   (b) shared_links is no longer the only org-scoped table missing
--       org_id (consistency win for code review);
--   (c) a future server-component SELECT via auth-client becomes
--       supportable with a normal RLS policy if we ever need it.
--
-- The polymorphic target_id pattern (study | campaign | townhall |
-- conversation | analytics) means backfill is per-type. Conversations
-- target a bot OR a response; both paths are covered below.

BEGIN;

-- 1. Add org_id (nullable for backfill)
ALTER TABLE shared_links
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Backfill per type. Each UPDATE is idempotent (only touches rows
--    where org_id is still null).

-- type = 'study' → studies.org_id
UPDATE shared_links sl
SET org_id = s.org_id
FROM studies s
WHERE sl.type = 'study'
  AND sl.target_id = s.id
  AND sl.org_id IS NULL;

-- type = 'campaign' → campaigns.org_id
UPDATE shared_links sl
SET org_id = c.org_id
FROM campaigns c
WHERE sl.type = 'campaign'
  AND sl.target_id = c.id
  AND sl.org_id IS NULL;

-- type = 'townhall' → townhall_sessions.org_id
UPDATE shared_links sl
SET org_id = t.org_id
FROM townhall_sessions t
WHERE sl.type = 'townhall'
  AND sl.target_id = t.id
  AND sl.org_id IS NULL;

-- type = 'analytics' → datasets.org_id  (target_id is a dataset id)
UPDATE shared_links sl
SET org_id = d.org_id
FROM datasets d
WHERE sl.type = 'analytics'
  AND sl.target_id = d.id
  AND sl.org_id IS NULL;

-- type = 'conversation' (path A): target_id is a bot id
UPDATE shared_links sl
SET org_id = b.org_id
FROM bots b
WHERE sl.type = 'conversation'
  AND sl.target_id = b.id
  AND sl.org_id IS NULL;

-- type = 'conversation' (path B): target_id is a response id; join to studies
UPDATE shared_links sl
SET org_id = s.org_id
FROM responses r
JOIN studies s ON s.id = r.study_id
WHERE sl.type = 'conversation'
  AND sl.target_id = r.id
  AND sl.org_id IS NULL;

-- 3. Delete orphan rows (target no longer exists in any parent table).
--    These are dead links — they would 404 on the public token page
--    anyway. We need them gone before NOT NULL.
DELETE FROM shared_links WHERE org_id IS NULL;

-- 4. Enforce NOT NULL going forward
ALTER TABLE shared_links ALTER COLUMN org_id SET NOT NULL;

-- 5. Index for the (org_id, …) filter pattern this enables
CREATE INDEX IF NOT EXISTS idx_shared_links_org ON shared_links(org_id);

COMMIT;
