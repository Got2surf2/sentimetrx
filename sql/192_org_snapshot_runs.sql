-- 192_org_snapshot_runs.sql
-- A durable, queryable record of every per-tenant backup attempt.
--
-- WHY. Until now the nightly org-snapshot cron reported its outcome in exactly
-- three places, none of them durable: the HTTP response body (gone the moment
-- the cron returns), `console.error` (gone when Vercel's logs rotate), and a
-- Sentry event carrying an aggregate count. That is how the 2026-08-08 event
-- sat for a week: the alert said "1/9 orgs failed", the logs had rotated, and
-- NOBODY COULD SAY WHICH ORG HAD NO BACKUP. The cron's own source comments say
-- exactly this.
--
-- The operational question a backup system has to be able to answer is "which
-- tenants do NOT have a good snapshot for day D, and why" — at any later time,
-- not only while the logs are warm. That needs a table.
--
-- GRAIN: one row per (org, snapshot day). The cron is resumable and hops across
-- invocations, so a single org's backup can be touched several times in a night;
-- the row is UPSERTED so it always holds the LATEST outcome for that day rather
-- than accumulating one row per hop. `attempts` counts the touches.
--
-- STATUS is deliberately four-valued, because "failed" alone would hide the
-- dangerous case: an INCOMPLETE snapshot is one that uploaded and has a manifest
-- but silently dropped a table that failed to read. That must never read as a
-- green backup, which is why the cron already treats fetch_errors as an error.
--   ok         — manifest committed, no fetch errors
--   incomplete — manifest committed, but one or more tables failed to read
--   partial    — ran out of time mid-org; parts uploaded, NO manifest yet
--   failed     — threw, or gave up; no usable snapshot
--
-- RLS: org-scoped SELECT (the multi-tenancy invariant for every new public
-- table). No write policy — the cron and the admin route both write with the
-- service-role client. A tenant may see its own backup history; only the admin
-- org sees the fleet, via is_platform_admin().

BEGIN;

CREATE TABLE IF NOT EXISTS org_snapshot_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  snapshot_day  date NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok', 'incomplete', 'partial', 'failed')),
  manifest_key  text,                    -- S3 key of the committed manifest (null unless ok/incomplete)
  size_bytes    bigint,
  row_counts    jsonb,                   -- per-table row counts actually captured
  fetch_errors  jsonb,                   -- per-table read failures; non-empty => incomplete
  error         text,                    -- truncated failure cause
  duration_ms   integer,
  hop           integer,                 -- which continuation hop finished it (debugging the resumable walk)
  attempts      integer NOT NULL DEFAULT 1,
  trigger       text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per org per day; the cron upserts onto this as it hops.
CREATE UNIQUE INDEX IF NOT EXISTS idx_osr_org_day ON org_snapshot_runs (org_id, snapshot_day);

-- The two operational reads: "how did last night go across the fleet" and
-- "show me this org's backup history".
CREATE INDEX IF NOT EXISTS idx_osr_day_status ON org_snapshot_runs (snapshot_day DESC, status);
CREATE INDEX IF NOT EXISTS idx_osr_org_recent ON org_snapshot_runs (org_id, snapshot_day DESC);

ALTER TABLE org_snapshot_runs ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant), admin org sees the fleet.
-- No write policy → RLS denies anon/authenticated writes entirely; the cron and
-- the admin snapshot route write with the service-role client.
DROP POLICY IF EXISTS org_snapshot_runs_org_read ON org_snapshot_runs;
CREATE POLICY org_snapshot_runs_org_read ON org_snapshot_runs
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()) OR is_platform_admin());

COMMENT ON TABLE org_snapshot_runs IS
  'Durable per-tenant backup outcome, one row per (org, snapshot day), upserted as the resumable cron hops. Exists because the nightly run previously reported only to the HTTP response, console.error and an aggregate Sentry count — so when the 2026-08-08 alert said "1/9 orgs failed" and Vercel''s logs had rotated, nobody could say which org had no backup. status=incomplete is the dangerous case: a manifest was committed but a table failed to read, so it must never read as a green backup. sql/192.';

-- Upsert one (org, day) outcome. Done in SQL so the resumable cron's repeated
-- touches increment `attempts` atomically rather than racing a read-modify-write
-- across hops.
--
-- Last-write-wins on status, deliberately: if an org completed and a later
-- manual run failed, the honest current state IS failed. Only manifest_key and
-- size_bytes are COALESCEd, so a later partial hop cannot erase the pointer to
-- the last good manifest.
--
-- NOT SECURITY DEFINER: service_role bypasses RLS already, so this needs no
-- elevation — and every SECURITY DEFINER function is a surface that has to be
-- kept off anon (see SECURITY.md §2 / sql/190). Grants follow the same posture.
CREATE OR REPLACE FUNCTION record_org_snapshot_run(
  p_org_id       uuid,
  p_day          date,
  p_status       text,
  p_manifest_key text    DEFAULT NULL,
  p_size_bytes   bigint  DEFAULT NULL,
  p_row_counts   jsonb   DEFAULT NULL,
  p_fetch_errors jsonb   DEFAULT NULL,
  p_error        text    DEFAULT NULL,
  p_duration_ms  integer DEFAULT NULL,
  p_hop          integer DEFAULT NULL,
  p_trigger      text    DEFAULT 'cron'
)
RETURNS void
LANGUAGE sql
SET search_path = public AS $$
  INSERT INTO org_snapshot_runs (
    org_id, snapshot_day, status, manifest_key, size_bytes,
    row_counts, fetch_errors, error, duration_ms, hop, trigger
  )
  VALUES (
    p_org_id, p_day, p_status, p_manifest_key, p_size_bytes,
    p_row_counts, p_fetch_errors, p_error, p_duration_ms, p_hop, COALESCE(p_trigger, 'cron')
  )
  ON CONFLICT (org_id, snapshot_day) DO UPDATE SET
    status       = EXCLUDED.status,
    manifest_key = COALESCE(EXCLUDED.manifest_key, org_snapshot_runs.manifest_key),
    size_bytes   = COALESCE(EXCLUDED.size_bytes,   org_snapshot_runs.size_bytes),
    row_counts   = COALESCE(EXCLUDED.row_counts,   org_snapshot_runs.row_counts),
    fetch_errors = EXCLUDED.fetch_errors,
    error        = EXCLUDED.error,
    duration_ms  = EXCLUDED.duration_ms,
    hop          = EXCLUDED.hop,
    trigger      = EXCLUDED.trigger,
    attempts     = org_snapshot_runs.attempts + 1,
    updated_at   = now();
$$;

REVOKE ALL ON FUNCTION record_org_snapshot_run(uuid, date, text, text, bigint, jsonb, jsonb, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_org_snapshot_run(uuid, date, text, text, bigint, jsonb, jsonb, text, integer, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_org_snapshot_run(uuid, date, text, text, bigint, jsonb, jsonb, text, integer, integer, text) TO service_role;

COMMIT;
