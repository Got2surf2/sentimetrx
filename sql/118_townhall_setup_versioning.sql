-- 118_townhall_setup_versioning.sql
-- Town Hall: set-up-before-media + analysis attribution + config version history.
-- Full design: docs/RECORDINGS.md § 2.8 (Project setup, attribution & versioning).
--
-- Four things land here, all additive (older recordings behave exactly as before):
--   1. Lifecycle states 'draft' / 'awaiting_media' in FRONT of the existing
--      pipeline, so a project can be fully set up before any audio/video exists.
--      Media is attached later via the "Add recording" action, which moves the
--      row into 'uploading' and the normal pipeline takes over.
--   2. Analysis attribution — analysis_org (default Datanautix) + analysts[] —
--      printed on the report/deck. Distinct from brand_tag/underlying_agent_id
--      (those are the CLIENT's brand/agent, used for entity matching).
--   3. Meeting objectives, setup provenance, confidentiality class, sign-off —
--      the "high-end" intake fields. objectives also steers the synthesis pass.
--   4. recording_config_versions — a snapshot of the project config, taken on
--      every analysis run (source='analysis') and on a manual "Save version"
--      (source='manual'). recordings.analyzed_config_version stamps which
--      version produced the current analysis_summary, for traceability.

BEGIN;

-- =========================================================================
-- 1. Lifecycle: add 'draft' (mid-setup) and 'awaiting_media' (setup done,
--    no recording attached yet) ahead of 'uploading'.
-- =========================================================================

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_status_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_status_check
  CHECK (status IN ('draft', 'awaiting_media',
                    'uploading', 'queued', 'extracting', 'transcribing',
                    'transcribed', 'analyzing', 'rendering', 'complete',
                    'failed', 'cancelled'));

-- 'draft' and 'awaiting_media' are stable wait states (not active processing),
-- so exclude them from the active-pipeline partial index alongside 'transcribed'
-- and the terminal states.
DROP INDEX IF EXISTS recordings_status_active_idx;
CREATE INDEX IF NOT EXISTS recordings_status_active_idx
  ON recordings (status)
  WHERE status NOT IN ('draft', 'awaiting_media', 'transcribed',
                       'complete', 'failed', 'cancelled');

-- =========================================================================
-- 2 + 3. Attribution + intake fields on recordings.
-- =========================================================================

ALTER TABLE recordings
  -- Org performing the analysis (the consulting brand), default Datanautix.
  ADD COLUMN IF NOT EXISTS analysis_org TEXT NOT NULL DEFAULT 'Datanautix',
  -- Analyst(s) from that org. [{name, member_id?}] — member_id set when the
  -- analyst is an app user, absent when typed free-text.
  ADD COLUMN IF NOT EXISTS analysts JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Meeting objectives: {summary, questions:[string]}. AI-proposed from the
  -- uploaded deck/briefs at setup, then editable. Steers the synthesis pass.
  ADD COLUMN IF NOT EXISTS objectives JSONB,
  -- Provenance per pre-filled setup field: {agenda?, panel?, glossary?,
  -- objectives?} → source document filename. Empty when typed by hand.
  ADD COLUMN IF NOT EXISTS setup_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Distribution classification, stamped on exports.
  ADD COLUMN IF NOT EXISTS confidentiality_class TEXT NOT NULL DEFAULT 'client_confidential'
    CHECK (confidentiality_class IN ('public', 'internal', 'client_confidential', 'restricted')),
  -- Analyst sign-off: {approved_by, approved_by_member_id?, approved_at, note?}.
  -- NULL until a reviewer approves the report for distribution.
  ADD COLUMN IF NOT EXISTS signoff JSONB,
  -- The config version_number whose snapshot produced the current
  -- analysis_summary. NULL until the first analysis runs.
  ADD COLUMN IF NOT EXISTS analyzed_config_version INT;

-- =========================================================================
-- 4. recording_config_versions — config snapshot history for traceability.
-- =========================================================================

CREATE TABLE IF NOT EXISTS recording_config_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL,                          -- denormalized; pairs with id on service-role reads
  version_number        int NOT NULL,                          -- 1-based, monotonic per recording
  snapshot              jsonb NOT NULL,                        -- full project config at snapshot time (see RecordingConfigSnapshot)
  source                text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'analysis')),
  change_note           text,                                  -- optional note on a manual save
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recording_id, version_number)
);

CREATE INDEX IF NOT EXISTS recording_config_versions_recording_idx
  ON recording_config_versions (recording_id, version_number DESC);
CREATE INDEX IF NOT EXISTS recording_config_versions_org_idx
  ON recording_config_versions (org_id);

ALTER TABLE recording_config_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recording_config_versions_org_read ON recording_config_versions;
CREATE POLICY recording_config_versions_org_read ON recording_config_versions
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- Comments
-- =========================================================================

COMMENT ON COLUMN recordings.analysis_org IS
  'Org performing the analysis (consulting brand), default Datanautix. Printed on report/deck. NOT the client brand — see brand_tag.';
COMMENT ON COLUMN recordings.analysts IS
  'Analyst(s) from analysis_org: [{name, member_id?}]. member_id set when the analyst is an app user, absent for free-text names.';
COMMENT ON COLUMN recordings.objectives IS
  '{summary:string, questions:[string]} — meeting objectives, AI-proposed from uploaded docs then edited. Steers the synthesis pass.';
COMMENT ON COLUMN recordings.setup_provenance IS
  'Maps a pre-filled setup field (agenda/panel/glossary/objectives) to the source document filename it was extracted from. {} when typed by hand.';
COMMENT ON COLUMN recordings.confidentiality_class IS
  'Distribution classification stamped on exports: public | internal | client_confidential (default) | restricted.';
COMMENT ON COLUMN recordings.signoff IS
  '{approved_by, approved_by_member_id?, approved_at, note?} — analyst sign-off; NULL until the report is approved for distribution.';
COMMENT ON COLUMN recordings.analyzed_config_version IS
  'recording_config_versions.version_number whose snapshot produced the current analysis_summary. Drives the "Config vN" footer stamp.';
COMMENT ON TABLE recording_config_versions IS
  'Config snapshot history for a recording. Auto-snapshot on each analysis run (source=analysis) + manual "Save version" (source=manual). See docs/RECORDINGS.md § 2.8.';

COMMIT;
