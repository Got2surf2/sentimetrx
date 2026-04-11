-- Add recipient_guid column to campaign_respondents
-- This unique GUID is embedded in survey URLs for per-respondent tracking

ALTER TABLE campaign_respondents
  ADD COLUMN IF NOT EXISTS recipient_guid TEXT UNIQUE;

-- Backfill existing rows with generated GUIDs
UPDATE campaign_respondents
SET recipient_guid = encode(gen_random_bytes(8), 'hex') || to_hex(extract(epoch from now())::int)
WHERE recipient_guid IS NULL;

-- Make it NOT NULL going forward
ALTER TABLE campaign_respondents
  ALTER COLUMN recipient_guid SET NOT NULL;

-- Index for fast lookup when survey response comes back with recipient_guid
CREATE INDEX IF NOT EXISTS idx_respondents_guid
  ON campaign_respondents(recipient_guid);
