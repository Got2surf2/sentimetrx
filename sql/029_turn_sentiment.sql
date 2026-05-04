-- 029_turn_sentiment.sql
-- Turn-level sentiment scoring for Town Hall and Agent conversations

-- Town Hall turns: sentiment label + numeric score
ALTER TABLE townhall_turns ADD COLUMN IF NOT EXISTS sentiment TEXT;
ALTER TABLE townhall_turns ADD COLUMN IF NOT EXISTS sentiment_score REAL;

-- Agent conversation turns: sentiment label + numeric score
ALTER TABLE bot_conversation_turns ADD COLUMN IF NOT EXISTS sentiment TEXT;
ALTER TABLE bot_conversation_turns ADD COLUMN IF NOT EXISTS sentiment_score REAL;
