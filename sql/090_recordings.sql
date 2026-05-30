-- 090_recordings.sql
--
-- Recordings module — audio/video meeting recordings → transcript → analytical
-- pass → structured report. Productizes the manual NOWOCATS PM-1 pipeline.
-- Full spec: docs/RECORDINGS.md.
--
-- Four tables, all with org-scoped RLS from day one:
--   recordings              — one row per uploaded meeting; owns pipeline state + share token
--   recording_files         — one row per source file (multi-file meetings get stitched in order)
--   recording_transcripts   — one row per recording (post-stitch), JSONB segments + vendor metadata
--   recording_extractions   — structured units from the Claude analytical pass
--                              (Q&A pairs for session_type='qa', etc.)
--
-- Spec deviation: org_id is denormalized on recording_files / _transcripts /
-- _extractions even though it could derive from recording_id. This matches the
-- codebase convention (see sql/088_dataset_row_taxonomy.sql) and makes the
-- (id, org_id) service-role pairing invariant uniform across every table.

BEGIN;

-- =========================================================================
-- recordings
-- =========================================================================

CREATE TABLE IF NOT EXISTS recordings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by            uuid NOT NULL REFERENCES auth.users(id),
  dataset_id            uuid REFERENCES datasets(id) ON DELETE SET NULL,

  name                  text NOT NULL,
  session_type          text NOT NULL
                          CHECK (session_type IN ('qa', 'focus_group', 'general_meeting', 'interview', 'lecture')),
  meeting_date          date,
  location              text,
  language              text NOT NULL DEFAULT 'en',           -- BCP-47, e.g. 'en', 'es', 'en-es'
  setup_inputs          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- per-type form (panel, agenda, ...)

  asr_strategy          text NOT NULL DEFAULT 'auto'
                          CHECK (asr_strategy IN ('auto', 'whisper', 'deepgram', 'hybrid')),
  asr_vendor_chosen     text,                                  -- resolved at runtime

  status                text NOT NULL DEFAULT 'uploading'
                          CHECK (status IN ('uploading', 'queued', 'extracting', 'transcribing',
                                            'analyzing', 'rendering', 'complete', 'failed', 'cancelled')),
  error_message         text,

  source_duration_sec   int,                                   -- total audio length across all files
  source_size_bytes     bigint,                                -- total bytes across all files
  cost_cents            int NOT NULL DEFAULT 0,

  coverage_report       jsonb,                                 -- per-topic density, confidence histogram (§ 3.6)

  -- Public sharing — v1 distribution path ("send link to principals at end of meeting")
  share_token           text UNIQUE,                           -- random 24-char URL-safe; NULL until enabled
  share_enabled         boolean NOT NULL DEFAULT false,
  share_expires_at      timestamptz,
  share_password_hash   text,                                  -- bcrypt; NULL = no password

  created_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  completed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS recordings_org_idx
  ON recordings (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recordings_dataset_idx
  ON recordings (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS recordings_status_active_idx
  ON recordings (status) WHERE status NOT IN ('complete', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS recordings_share_token_idx
  ON recordings (share_token) WHERE share_token IS NOT NULL;

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recordings_org_read ON recordings;
CREATE POLICY recordings_org_read ON recordings
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- recording_files
-- =========================================================================

CREATE TABLE IF NOT EXISTS recording_files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL,                         -- denormalized; pairs with id on service-role reads

  original_filename     text NOT NULL,
  storage_path          text NOT NULL,                          -- <org_id>/<recording_id>/<filename>
  mime_type             text NOT NULL,
  size_bytes            bigint NOT NULL,
  duration_sec          int,                                    -- populated post-extract
  is_video              boolean NOT NULL,
  audio_storage_path    text,                                   -- ffmpeg-extracted audio if source was video
  sort_order            int NOT NULL DEFAULT 0,
  upload_status         text NOT NULL DEFAULT 'pending'
                          CHECK (upload_status IN ('pending', 'uploaded', 'extracted', 'failed')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_files_recording_idx
  ON recording_files (recording_id, sort_order);
CREATE INDEX IF NOT EXISTS recording_files_org_idx
  ON recording_files (org_id);

ALTER TABLE recording_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recording_files_org_read ON recording_files;
CREATE POLICY recording_files_org_read ON recording_files
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- recording_transcripts
-- =========================================================================

CREATE TABLE IF NOT EXISTS recording_transcripts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          uuid NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL,                         -- denormalized

  vendor                text NOT NULL CHECK (vendor IN ('whisper', 'deepgram', 'hybrid')),
  language_detected     text,
  segments              jsonb NOT NULL,                         -- [{start, end, speaker?, text, confidence?, source_file?, source_offset?}]
  raw_response          jsonb,                                  -- vendor raw, kept for re-analysis / debugging
  word_count            int,
  duration_sec          int,
  cost_cents            int NOT NULL DEFAULT 0,
  completed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_transcripts_org_idx
  ON recording_transcripts (org_id);

ALTER TABLE recording_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recording_transcripts_org_read ON recording_transcripts;
CREATE POLICY recording_transcripts_org_read ON recording_transcripts
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- recording_extractions
-- =========================================================================

CREATE TABLE IF NOT EXISTS recording_extractions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL,                         -- denormalized

  unit_type             text NOT NULL,                          -- 'qa_pair' | 'quote' | 'action_item' | ...
  topic                 text,                                   -- section / theme name
  payload               jsonb NOT NULL,                         -- type-specific structure
  start_sec             int,                                    -- pointer back to transcript timeline
  end_sec               int,
  source_file           text,                                   -- which input clip
  confidence            numeric(3,2),                           -- 0.00 - 1.00
  flagged_for_review    boolean NOT NULL DEFAULT false,
  flag_reason           text,                                   -- 'low_confidence' | 'curator_questioned' | ...
  sort_order            int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_extractions_recording_idx
  ON recording_extractions (recording_id, sort_order);
CREATE INDEX IF NOT EXISTS recording_extractions_topic_idx
  ON recording_extractions (recording_id, topic);
CREATE INDEX IF NOT EXISTS recording_extractions_flagged_idx
  ON recording_extractions (recording_id) WHERE flagged_for_review;
CREATE INDEX IF NOT EXISTS recording_extractions_org_idx
  ON recording_extractions (org_id);

ALTER TABLE recording_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recording_extractions_org_read ON recording_extractions;
CREATE POLICY recording_extractions_org_read ON recording_extractions
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- Comments
-- =========================================================================

COMMENT ON TABLE recordings IS
  'One row per uploaded meeting recording. Owns pipeline state, share token, cost accumulator, and the back-reference to the derived datasets row. See docs/RECORDINGS.md.';

COMMENT ON COLUMN recordings.setup_inputs IS
  'Per session_type payload. qa: {panel:[{name,role}], agenda:[string], ground_truth_url?:string}. focus_group / interview / general_meeting / lecture shapes documented in docs/RECORDINGS.md § 2.1.';

COMMENT ON COLUMN recordings.share_token IS
  'Random 24-char URL-safe token granting public read access at /r/<token>. NULL until POST /api/recordings/[id]/share is called. Rotating issues a new token and 404s the old one.';

COMMENT ON COLUMN recording_transcripts.segments IS
  'JSONB array of {start,end,speaker?,text,confidence?}. When the source was multi-file, each segment also carries source_file + source_offset for the future audio-playback viewer.';

COMMENT ON COLUMN recording_extractions.payload IS
  'Shape depends on unit_type. qa_pair: {question,asker_name?,answer,panelist_name?,question_typology}. quote / action_item shapes in docs/RECORDINGS.md § 2.4.';

COMMENT ON COLUMN recording_extractions.flag_reason IS
  'Why the row is flagged for human review. Today: low_confidence, curator_questioned (Sonnet 4.6 second-pass disagreed), cross_vendor_disagreement (hybrid ASR), panel_to_panel_suspect.';

COMMIT;
