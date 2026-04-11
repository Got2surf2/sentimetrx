-- Migration: Add missing columns to responses table
-- These columns are required by the /api/respond endpoint for:
--   - Partial saves (session_id + status='incomplete')
--   - Final submit (status='complete')
--   - Device fingerprint dedup (fp_hash)
--
-- Run this on BOTH staging and production Supabase.

-- 1. status: tracks whether a response is partial or complete
ALTER TABLE responses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'complete';

-- 2. session_id: ties partial saves to the same response row
ALTER TABLE responses ADD COLUMN IF NOT EXISTS session_id TEXT;

-- 3. fp_hash: SHA-256 of device fingerprint for duplicate detection
ALTER TABLE responses ADD COLUMN IF NOT EXISTS fp_hash TEXT;

-- 4. completed_at should be nullable (partials don't have it yet)
ALTER TABLE responses ALTER COLUMN completed_at DROP DEFAULT;
ALTER TABLE responses ALTER COLUMN completed_at DROP NOT NULL;

-- 5. Indexes for the queries in /api/respond
CREATE INDEX IF NOT EXISTS idx_responses_session_id ON responses(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_fp_hash ON responses(fp_hash) WHERE fp_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_study_status ON responses(study_id, status);

-- 6. Backfill: mark all existing responses as complete
UPDATE responses SET status = 'complete' WHERE status IS NULL;

-- 7. Refresh materialized view to pick up the status column
REFRESH MATERIALIZED VIEW CONCURRENTLY study_response_stats;
