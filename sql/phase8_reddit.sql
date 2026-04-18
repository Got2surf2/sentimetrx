-- Phase 8: Reddit downloader tables
-- On-demand download of Reddit posts/comments into datasets

-- =============================================================
-- 1. reddit_sources — one row per Reddit download job
-- =============================================================
CREATE TABLE IF NOT EXISTS reddit_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id      UUID REFERENCES datasets(id) ON DELETE SET NULL,
  search_query    TEXT NOT NULL,
  subreddits      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','downloading','done','error')),
  total_posts     INT NOT NULL DEFAULT 0,
  total_comments  INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rds_org     ON reddit_sources(org_id);
CREATE INDEX idx_rds_dataset ON reddit_sources(dataset_id);

-- =============================================================
-- 2. reddit_source_threads — selected threads for download
-- =============================================================
CREATE TABLE IF NOT EXISTS reddit_source_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reddit_source_id  UUID NOT NULL REFERENCES reddit_sources(id) ON DELETE CASCADE,
  thread_id         TEXT NOT NULL,
  subreddit         TEXT NOT NULL,
  title             TEXT NOT NULL,
  author            TEXT,
  score             INT NOT NULL DEFAULT 0,
  comment_count     INT NOT NULL DEFAULT 0,
  permalink         TEXT,
  created_utc       TIMESTAMPTZ,
  selected          BOOLEAN NOT NULL DEFAULT true,
  total_pulled      INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rst_source ON reddit_source_threads(reddit_source_id);
CREATE UNIQUE INDEX idx_rst_source_thread
  ON reddit_source_threads(reddit_source_id, thread_id);

-- =============================================================
-- 3. RLS — service-role full access
-- =============================================================
ALTER TABLE reddit_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_source_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on reddit_sources"
  ON reddit_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on reddit_source_threads"
  ON reddit_source_threads FOR ALL USING (true) WITH CHECK (true);
