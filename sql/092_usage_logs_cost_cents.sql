-- 092_usage_logs_cost_cents.sql
--
-- Add a nullable flat-cost column to usage_logs. Token-based AI costs are
-- derived from input/output tokens via lib/usageRates; some usage has a known
-- dollar cost but NO token count — e.g. the ASR/transcription vendor charge for
-- recordings. This column lets that flat cost land in the accounting dashboard.
--
-- NULL = no flat cost; the row's cost is token-derived (the existing behavior).
-- When set, the dashboard adds cost_cents/100 to the token-derived cost.

BEGIN;

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_cents INTEGER;

COMMENT ON COLUMN usage_logs.cost_cents IS
  'Flat cost in cents for non-token usage (e.g. ASR transcription). NULL = cost derived from tokens.';

COMMIT;
