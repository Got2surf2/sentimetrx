-- Add language support columns to townhall_turns
ALTER TABLE townhall_turns ADD COLUMN IF NOT EXISTS user_message_en TEXT;
ALTER TABLE townhall_turns ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Add slug column to townhall_sessions
ALTER TABLE townhall_sessions ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
