-- 028_demographic_inference.sql
-- Optional demographic inference on agent conversations

-- Toggle on bots table
ALTER TABLE bots ADD COLUMN IF NOT EXISTS demographic_inference BOOLEAN DEFAULT false;

-- Demographics stored alongside existing persona
ALTER TABLE bot_session_personas ADD COLUMN IF NOT EXISTS demographics JSONB;
