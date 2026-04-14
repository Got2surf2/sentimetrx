-- 014_townhall_theme_detection.sql
-- Add columns for live theme detection: keywords, sentiment on themes; detection timestamp on sessions

-- Theme-level: store keywords array and sentiment for detected themes
ALTER TABLE townhall_themes ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';
ALTER TABLE townhall_themes ADD COLUMN IF NOT EXISTS sentiment TEXT DEFAULT 'neutral';

-- Session-level: track when detection last ran
ALTER TABLE townhall_sessions ADD COLUMN IF NOT EXISTS last_theme_detection_at TIMESTAMPTZ;
