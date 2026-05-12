-- 051 — Per-org Anthropic key (BYO-key) for the AI billing escape hatch.
--
-- Default: ai_key_mode = 'platform' → every AI call for this org goes
-- through ANTHROPIC_API_KEY env (platform absorbs cost; usage tracked
-- per-org in usage_log). Set to 'byo' AND populate ai_api_key for orgs
-- that want to pay Anthropic directly.
--
-- ai_api_key holds the raw secret in plaintext (column-level access is
-- restricted by RLS — only platform admins can read it). Lives in a
-- dedicated column rather than features JSONB because features is
-- selected widely across the app; a secret in features would leak.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_key_mode text NOT NULL DEFAULT 'platform'
    CHECK (ai_key_mode IN ('platform', 'byo')),
  ADD COLUMN IF NOT EXISTS ai_api_key text,
  ADD COLUMN IF NOT EXISTS ai_api_key_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_api_key_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organizations.ai_api_key
  IS 'Raw Anthropic API key for BYO orgs. Read only via service-role; never exposed to clients. RLS keeps this column out of normal org SELECTs (only super-admins should see set_at / set_by metadata via dedicated admin endpoints).';
