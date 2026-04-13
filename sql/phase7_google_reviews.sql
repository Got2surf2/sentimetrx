-- Phase 7: Google Reviews downloader tables
-- Supports generic brand search → location discovery → review pull → periodic sync

-- =============================================================
-- 1. review_sources — one row per brand / org configuration
-- =============================================================
CREATE TABLE IF NOT EXISTS review_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id            UUID REFERENCES datasets(id) ON DELETE SET NULL,
  brand_name            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','searching','active','paused','error')),
  sync_frequency_hours  INT NOT NULL DEFAULT 24,
  last_synced_at        TIMESTAMPTZ,
  next_sync_at          TIMESTAMPTZ,
  error_message         TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rs_org        ON review_sources(org_id);
CREATE INDEX idx_rs_dataset    ON review_sources(dataset_id);
CREATE INDEX idx_rs_next_sync  ON review_sources(next_sync_at) WHERE status = 'active';

-- =============================================================
-- 2. review_source_locations — each discovered location for a brand
-- =============================================================
CREATE TABLE IF NOT EXISTS review_source_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_source_id  UUID NOT NULL REFERENCES review_sources(id) ON DELETE CASCADE,
  place_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  address           TEXT,
  city              TEXT,
  state             TEXT,
  zip               TEXT,
  rating            NUMERIC(2,1),
  review_count      INT NOT NULL DEFAULT 0,
  selected          BOOLEAN NOT NULL DEFAULT false,
  last_review_id    TEXT,
  last_review_date  TIMESTAMPTZ,
  total_pulled      INT NOT NULL DEFAULT 0,
  last_synced_at    TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rsl_source ON review_source_locations(review_source_id);
CREATE INDEX idx_rsl_place  ON review_source_locations(place_id);
CREATE UNIQUE INDEX idx_rsl_source_place
  ON review_source_locations(review_source_id, place_id);

-- =============================================================
-- 3. user_locations — maps users to specific locations for scoped access
-- =============================================================
CREATE TABLE IF NOT EXISTS user_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_source_id  UUID NOT NULL REFERENCES review_sources(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES review_source_locations(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);

CREATE INDEX idx_ul_user   ON user_locations(user_id);
CREATE INDEX idx_ul_source ON user_locations(review_source_id);

-- =============================================================
-- 4. RLS — service-role full access (matches dataset_rows_flat pattern)
-- =============================================================
ALTER TABLE review_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_source_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on review_sources"
  ON review_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on review_source_locations"
  ON review_source_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on user_locations"
  ON user_locations FOR ALL USING (true) WITH CHECK (true);
