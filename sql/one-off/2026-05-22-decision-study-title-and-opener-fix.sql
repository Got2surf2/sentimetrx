-- 2026-05-22 — Decision Study agent: page <title> + opener fix
--
-- Second pass after `2026-05-22-decision-study-name-fix.sql` caught the
-- widget header. The page <title>, og:title, twitter:title (Open Graph
-- unfurls in iMessage / Slack / Twitter) and the browser tab are generated
-- from `agents.name` in `app/b/[slug]/page.tsx:56`, NOT from config.name.
-- So previous fix left "Chat with Decision Study (regret framework pilot)"
-- in every share-link preview + the browser tab. Direct violation of the
-- framework's design constraint #1.
--
-- Also: the opener said "Should take 5 to 7 minutes" — the word "should"
-- is on the framework's banned-word list (slide 4 of the deck).
--
-- Fix:
--   agents.name             →  "Decision Study"  (drops "regret framework pilot")
--   config.initialMessage   →  "Takes 5 to 7 minutes" (drops "Should")
--
-- system_prompt is NOT in the client-side bundle (page.tsx:24 selects only
-- id, name, slug, status, config) — no further leak there. config.framework
-- stays as 'regret_v1' but is only visible to someone viewing page source,
-- not to a normal respondent.

UPDATE public.agents
SET
  name = 'Decision Study',
  config = config
    || jsonb_build_object(
         'initialMessage',
         E'Hi — thanks for taking part. This is a short conversation about a recent decision. Takes 5 to 7 minutes. There are no right answers.\n\nTo start: think of a decision you made in the last few months — work, personal, anything — that''s still on your mind. What was the decision?'
       ),
  updated_at = now()
WHERE slug = 'decision-study'
RETURNING
  slug,
  name                                AS internal_name,
  config->>'name'                     AS displayed_name,
  config->>'subtitle'                 AS displayed_subtitle,
  config->>'avatarLetter'             AS displayed_avatar,
  left(config->>'initialMessage', 80) AS opener_first_80;
