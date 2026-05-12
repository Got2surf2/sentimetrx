-- 052 — Three-state AI mode + BYOK provider selection.
--
-- Adds 'off' as a valid ai_key_mode so an org can disable AI entirely
-- (no outbound calls to Anthropic, OpenAI, or Azure under any
-- circumstance — server enforces, embeddings/moderation return null,
-- streaming endpoints reject). Required for customers with data-
-- residency or privacy concerns who don't want anything leaving their
-- network to an AI vendor.
--
-- Adds ai_provider so BYOK orgs can specify whether their key is for
-- Anthropic or OpenAI. OpenAI BYOK substitutes for both LLM AND
-- embeddings/moderation. Anthropic BYOK substitutes the LLM only;
-- embeddings/moderation stay on the platform OpenAI key (cost is
-- pennies — we'd rather absorb it than silently break semantic search).

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_ai_key_mode_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_ai_key_mode_check
  CHECK (ai_key_mode IN ('off', 'platform', 'byo'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'anthropic'
    CHECK (ai_provider IN ('anthropic', 'openai'));

COMMENT ON COLUMN public.organizations.ai_key_mode
  IS 'AI routing mode. off = no AI calls allowed for this org under any circumstance (server enforces). platform = use Sentimetrx env keys (default). byo = use ai_api_key + ai_provider.';

COMMENT ON COLUMN public.organizations.ai_provider
  IS 'Provider for the BYOK key. Ignored when ai_key_mode != byo. OpenAI BYOK covers LLM + embeddings + moderation. Anthropic BYOK covers LLM only; embeddings/moderation fall back to platform OPENAI_API_KEY.';
