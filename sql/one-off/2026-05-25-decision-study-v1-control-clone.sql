-- 2026-05-25 — Clone current Decision Study agent into a control slug
-- so the new goal-tracker prompt (on /b/decision-study) can be A/B tested
-- against the existing phase-machine prompt (on /b/decision-study-v1).
--
-- The clone preserves every field of the source row (config, focuses,
-- system_prompt, etc.) so the only difference between the two agents is
-- the prompt architecture introduced in the goal-tracker SQL that runs
-- right after this one.
--
-- After this and the goal-tracker SQL apply:
--   /b/decision-study      → new goal-tracker prompt (V2)
--   /b/decision-study-v1   → original phase-machine prompt (V1 control)
--
-- The original `decision-study` row is then renamed to disambiguate in
-- admin views (its respondent-facing config.name = "Sarina" stays
-- identical so respondents have the same persona on both URLs).

INSERT INTO public.agents (
  org_id, name, slug, status, config, system_prompt, knowledge_base,
  training_urls, conversation_count, created_by, created_at, updated_at,
  personality, faq, facts, guardrails, opponents, contrast_mode, subject,
  negative_content_mode, sensitive_topics, focus_topics, deflection_enabled,
  deflection_message, ask_profile, profile_question, intents,
  demographic_inference, focuses, probe_focus_enabled
)
SELECT
  org_id,
  'Decision Study (phase-machine v1 control)' AS name,
  'decision-study-v1' AS slug,
  status,
  config,
  system_prompt,
  knowledge_base,
  training_urls,
  0 AS conversation_count,
  created_by,
  now() AS created_at,
  now() AS updated_at,
  personality,
  faq,
  facts,
  guardrails,
  opponents,
  contrast_mode,
  subject,
  negative_content_mode,
  sensitive_topics,
  focus_topics,
  deflection_enabled,
  deflection_message,
  ask_profile,
  profile_question,
  intents,
  demographic_inference,
  focuses,
  probe_focus_enabled
FROM public.agents
WHERE slug = 'decision-study'
ON CONFLICT (slug) DO NOTHING
RETURNING
  slug,
  name,
  status,
  length(system_prompt) AS prompt_len,
  (config->>'name') AS persona_name;
