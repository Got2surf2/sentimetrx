-- 021_collections.sql
-- Virtual dataset grouping: combine multiple datasets for cross-dataset analytics
-- No data duplication — rows are unioned at query time

CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id),
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  dataset_id    UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_org" ON collections
  FOR ALL USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "collection_members_org" ON collection_members
  FOR ALL USING (
    collection_id IN (SELECT id FROM collections WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))
  );

-- Indexes
CREATE INDEX idx_collections_org ON collections(org_id);
CREATE INDEX idx_collections_dataset ON collections(dataset_id);
CREATE INDEX idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX idx_collection_members_dataset ON collection_members(dataset_id);
