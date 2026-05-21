-- 2026-05-21 — Phase 6 prep
-- First town_halls row pointing at Sarina (live bot
-- 5c468b90-13fc-46a2-8855-312dc0a1e428) plus 3 seed topics for an early
-- Vindman-supporter cohort discussion. Slug 'sarina-cohort' so the new
-- /api/townhall/chat path (TOWNHALL_VIA_AGENT_HANDLER=true) can resolve
-- session_id='sarina-cohort' to this row and delegate through
-- handleChatTurn.
--
-- org_id is resolved at insert time via subquery so the value never
-- has to be hand-typed (or surfaced into the conversation transcript).
--
-- Idempotent on slug via the unique index town_halls_slug_idx.
-- Re-running this script is a no-op.

INSERT INTO town_halls (org_id, bot_id, slug, name, status, cohort_config, started_at)
SELECT
  a.org_id,
  a.id,
  'sarina-cohort',
  'Sarina Cohort — Vindman Supporters (Phase 6 prep)',
  'live',
  jsonb_build_object(
    'theme_detection_mode',                'auto',
    'theme_detection_every_n_responses',   10,
    'default_response_target',             8,
    'standby_message',                      'Thanks for sharing — that''s really helpful for what the campaign is hearing from supporters. I''ll let you go for now, and I may circle back if new themes emerge from other supporters.'
  ),
  now()
FROM agents a
WHERE a.id = '5c468b90-13fc-46a2-8855-312dc0a1e428'
ON CONFLICT (slug) DO NOTHING;

-- Three seed topics for the cohort. Use ON CONFLICT DO NOTHING on
-- (town_hall_id, label) — but town_hall_topics doesn't have that
-- unique index by default, so we manually skip if any seed topic
-- already exists for this town hall.

INSERT INTO town_hall_topics (org_id, town_hall_id, label, description, question, keywords, source, state, response_target, sort_order)
SELECT
  t.org_id,
  t.id,
  v.label,
  v.description,
  v.question,
  v.keywords,
  'seed',
  'active',
  8,
  v.sort_order
FROM town_halls t
CROSS JOIN (VALUES
  (
    'Local issues that matter most',
    'What community issues this supporter cares most about — schools, public safety, transportation, housing, environment, etc.',
    'What are the top one or two local issues you''d most like to see attention on right now?',
    ARRAY['school', 'safety', 'crime', 'transportation', 'transit', 'housing', 'environment', 'cost of living', 'taxes', 'jobs', 'health'],
    1
  ),
  (
    'What you''d want a state senator focused on',
    'What this supporter would want a state senator to focus on in Tallahassee — gives them space to think beyond local issues.',
    'If you were advising a state senator on priorities for the next session, what would you tell them to focus on?',
    ARRAY['legislature', 'tallahassee', 'state senate', 'bill', 'policy', 'budget', 'reform', 'priority', 'session'],
    2
  ),
  (
    'How you''d like to be involved',
    'What kind of involvement this supporter is open to — door-knocking, donating, attending events, sharing on social media, hosting neighbors.',
    'Beyond voting, is there anything you''d be open to doing to help the campaign — even small things like sharing on social or hosting a couple of neighbors?',
    ARRAY['volunteer', 'door', 'donate', 'donation', 'event', 'social', 'share', 'host', 'help', 'involved'],
    3
  )
) AS v(label, description, question, keywords, sort_order)
WHERE t.slug = 'sarina-cohort'
  AND NOT EXISTS (
    SELECT 1 FROM town_hall_topics x
    WHERE x.town_hall_id = t.id AND x.label = v.label
  );

-- Verify counts (no rows leaked; just confirms the insert lifecycle).
SELECT
  (SELECT count(*) FROM town_halls WHERE slug = 'sarina-cohort') AS town_halls_count,
  (SELECT count(*) FROM town_hall_topics tht JOIN town_halls th ON th.id = tht.town_hall_id WHERE th.slug = 'sarina-cohort') AS seed_topics_count;
