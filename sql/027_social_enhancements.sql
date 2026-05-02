-- 027_social_enhancements.sql
-- Social moderation enhancements (2026-05-01)
-- Adds handled flag for review workflow and numeric sentiment score

ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS is_handled BOOLEAN DEFAULT false;
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS sentiment_score NUMERIC;
