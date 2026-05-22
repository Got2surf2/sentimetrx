-- 2026-05-22 — Decision Study agent: respondent-visible string fix
--
-- The previous seed set agents.name = 'Decision Study (regret framework pilot)'
-- and config.subtitle = 'A short research conversation'. BotClient.tsx renders
-- both in the widget header, so the respondent saw the words "regret" and
-- "research" before typing — a direct violation of the Comparative Evaluation
-- Framework's design constraint #1 (do not prime "regret" or any synonym).
--
-- Fix: override config.name + config.subtitle (which take precedence over
-- agents.name and agents.subtitle in BotClient.tsx:26-27), drop the subtitle
-- entirely, swap the avatar letter. The internal agents.name stays as-is so
-- admin views remain unambiguous.
--
-- Public surface after this runs:
--   header name:  "Sarina"      (matches the discussion deck's framing)
--   subtitle:     ""             (removed — was "A short research conversation")
--   avatar:       "S"           (was "D")

UPDATE public.agents
SET config = config
  || jsonb_build_object(
       'name',         'Sarina',
       'subtitle',     '',
       'avatarLetter', 'S'
     ),
  updated_at = now()
WHERE slug = 'decision-study'
RETURNING
  slug,
  config->>'name'         AS displayed_name,
  config->>'subtitle'     AS displayed_subtitle,
  config->>'avatarLetter' AS displayed_avatar;
