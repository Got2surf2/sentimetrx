-- 019: Add 'analytics' to shared_links type
-- The shared_links table already has a metadata JSONB column (added in 018).
-- For analytics shares, metadata stores:
--   { dataset_id, filters, metrics, label }
-- No schema changes needed — just documenting the new type value.

-- Verify the metadata column exists (added in 018_shared_conversation.sql):
-- ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS metadata jsonb;

-- The 'analytics' type is now accepted alongside:
--   study, campaign, townhall, conversation
