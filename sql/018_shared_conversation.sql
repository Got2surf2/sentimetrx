-- 018: Extend shared_links for conversation sharing
-- Adds 'conversation' type and metadata JSONB column for storing rendered HTML
-- 2026-04-18

ALTER TABLE shared_links DROP CONSTRAINT IF EXISTS shared_links_type_check;
ALTER TABLE shared_links ADD CONSTRAINT shared_links_type_check CHECK (type IN ('study', 'campaign', 'townhall', 'conversation'));

ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
