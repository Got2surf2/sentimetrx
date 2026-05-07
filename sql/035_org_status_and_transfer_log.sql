-- 035_org_status_and_transfer_log.sql
-- Two pieces wired into the cross-module transfer flow:
--   1. organizations.status — gates which orgs can receive transfers and
--      which appear in the admin TransferOrg dropdown. Default 'active'
--      so existing orgs aren't affected.
--   2. org_transfers — append-only log of every cross-org resource move
--      (agent / study / dataset / townhall session). One row per transfer,
--      written from the PATCH endpoints, captures who/when/from/to plus
--      the resource identity.
--
-- 2026-05-08

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived'));

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

CREATE TABLE IF NOT EXISTS org_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type   TEXT NOT NULL CHECK (resource_type IN ('bot', 'study', 'dataset', 'townhall_session')),
  resource_id     UUID NOT NULL,
  resource_name   TEXT,                                              -- snapshot at transfer time
  from_org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  from_org_name   TEXT,                                              -- snapshot
  to_org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  to_org_name     TEXT,                                              -- snapshot
  initiated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_by_email TEXT,                                           -- snapshot
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_transfers_resource ON org_transfers(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_transfers_from_org ON org_transfers(from_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_transfers_to_org   ON org_transfers(to_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_transfers_actor    ON org_transfers(initiated_by, created_at DESC);

ALTER TABLE org_transfers ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read the transfer log.
CREATE POLICY "org_transfers_admin_read" ON org_transfers FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = auth.uid() AND o.is_admin_org));

-- Service role inserts (writes happen from the PATCH endpoints which use the
-- service-role client). No anon insert.
CREATE POLICY "org_transfers_service_insert" ON org_transfers FOR INSERT
  WITH CHECK (true);
