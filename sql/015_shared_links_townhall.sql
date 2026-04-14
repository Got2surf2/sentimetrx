-- 015_shared_links_townhall.sql
-- Extend shared_links to support Town Hall session type

ALTER TABLE shared_links DROP CONSTRAINT IF EXISTS shared_links_type_check;
ALTER TABLE shared_links ADD CONSTRAINT shared_links_type_check CHECK (type IN ('study', 'campaign', 'townhall'));
