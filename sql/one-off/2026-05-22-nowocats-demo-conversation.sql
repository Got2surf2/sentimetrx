-- 2026-05-22 — NOWOCATS demo conversation
--
-- A 14-turn credible demo conversation seeded into the NOWOCATS town
-- hall. Participant "Maria" — Apopka resident near Kelly Park Road,
-- covers the study's key topics with realistic sentiment mix:
--   - Traffic frustration on Kelly Park (negative)
--   - School-zone safety + sidewalk gaps (negative)
--   - Growth/sprawl concerns through 2050 (negative)
--   - Trail system appreciation (positive)
--   - Specific question that gets LOGGED (Plymouth Sorrento timeline)
--   - Both anchor asks answered (user_type=Resident, priority=safety/intersections)
--
-- Lands in BOTH substrates (legacy bot_conversation_turns +
-- phase-3 conversations/conversation_turns) so admin views work
-- regardless of READ_PHASE3 flag. Linked to NOWOCATS town hall via
-- town_hall_conversations.
--
-- Pre-populates agent_session_personas.name='Maria' (what the name
-- extractor would normally capture on user_turn_count==2).
--
-- One logged_questions row for the Plymouth Sorrento question
-- (classification='ai_uncertain').
--
-- Idempotent: cleans demo session first, then inserts. Re-running
-- is safe.

BEGIN;

-- ── Wipe prior runs of this demo (idempotency) ─────────────────────
DELETE FROM bot_conversation_turns
  WHERE session_id = 'bs_demo_nowocats_001';
DELETE FROM conversations
  WHERE session_id = 'bs_demo_nowocats_001';
DELETE FROM agent_session_personas
  WHERE session_id = 'bs_demo_nowocats_001';
DELETE FROM logged_questions
  WHERE session_id = 'bs_demo_nowocats_001';

-- ── Insert conversation + townhall link + persona ────────────────
WITH
  hall AS (
    SELECT id AS town_hall_id, org_id, bot_id
    FROM town_halls WHERE slug = 'nowocats'
  ),
  conv AS (
    INSERT INTO conversations (
      id, org_id, bot_id, session_id, participant_id, language, source, medium, campaign, metadata,
      turn_count, created_at, updated_at, ended_at
    )
    SELECT
      gen_random_uuid(),
      h.org_id,
      h.bot_id,
      'bs_demo_nowocats_001',
      'p_demo_maria_apopka',
      'en',
      'qr',         -- as if joined via postcard QR
      'postcard',
      'pm2-demo',
      jsonb_build_object('demo', true, 'note', 'NOWOCATS demo conversation seeded 2026-05-22'),
      14,
      now() - interval '2 hours',
      now() - interval '1 hour 50 minutes',
      now() - interval '1 hour 50 minutes'
    FROM hall h
    RETURNING id, org_id, bot_id, session_id, participant_id, created_at
  ),
  link AS (
    INSERT INTO town_hall_conversations (org_id, town_hall_id, conversation_id, joined_at)
    SELECT c.org_id, h.town_hall_id, c.id, c.created_at
    FROM conv c CROSS JOIN hall h
    RETURNING conversation_id
  ),
  persona AS (
    INSERT INTO agent_session_personas (bot_id, session_id, persona, name, demographics, created_at, updated_at)
    SELECT c.bot_id, c.session_id,
      jsonb_build_object(
        'life_stage',          jsonb_build_object('value','working parent','source','inferred','confidence','medium'),
        'location_type',       jsonb_build_object('value','suburban','source','inferred','confidence','high'),
        'concerns',            jsonb_build_object('values',jsonb_build_array('traffic','school safety','growth','small-town character'),'source','explicit','confidence','high'),
        'communication_style', jsonb_build_object('value','conversational','source','inferred','confidence','high')
      ),
      'Maria',
      jsonb_build_object(),
      now() - interval '1 hour 55 minutes',
      now() - interval '1 hour 50 minutes'
    FROM conv c
    RETURNING bot_id, session_id
  )
SELECT 'seed parent rows: conv + link + persona' AS step, (SELECT count(*) FROM conv) AS conv_inserted, (SELECT count(*) FROM link) AS link_inserted, (SELECT count(*) FROM persona) AS persona_inserted;

-- ── Insert 14 conversation_turns + 14 bot_conversation_turns ─────
-- Topic id lookups by label so the seed-on-activate row uuids are
-- referenced correctly without hand-typing them.

WITH
  c AS (SELECT id AS conversation_id, org_id, bot_id, session_id FROM conversations WHERE session_id='bs_demo_nowocats_001'),
  hall AS (SELECT id AS town_hall_id FROM town_halls WHERE slug='nowocats'),
  topic AS (
    SELECT
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='Where in NW Orange County') AS t_geo,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='Biggest transportation frustration') AS t_frust,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='Growth concerns (2050 outlook)') AS t_growth,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='Top priority improvement') AS t_priority,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='Specific road or intersection to flag') AS t_road,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='ANCHOR — User type (required before close)') AS t_anchor_user,
      (SELECT id FROM town_hall_topics WHERE town_hall_id=h.town_hall_id AND label='ANCHOR — Priority category (required before close)') AS t_anchor_pri
    FROM hall h
  )
INSERT INTO conversation_turns (
  id, conversation_id, org_id, turn_number, role, content, content_en, language, source,
  content_flags, sentiment, sentiment_score, topic_id, created_at
)
SELECT
  gen_random_uuid(), c.conversation_id, c.org_id, v.tn, v.role, v.content, v.content, 'en', v.src,
  NULLIF(v.flags, '[]'::jsonb), v.sentiment, v.score, v.tid, c2 AS created_at
FROM c
CROSS JOIN topic
CROSS JOIN LATERAL (
  SELECT (now() - (interval '2 hours' - (turn_offset * interval '45 seconds'))) AS c2,
         tn, role, content, src, flags::jsonb, sentiment, score, tid
  FROM (VALUES
    (0,  1,  'assistant', 'Hi — I''m Sarina, the NOWOCATS Assistant. What''s your first name? And are you here to learn about the study, or share your thoughts?',                                                                                                                                                                                                       'greeting',  '[]', NULL,        NULL,   NULL),
    (1,  2,  'user',      'Maria. I''m here to share thoughts — the traffic situation around here is getting out of control.',                                                                                                                                                                                                                                              'normal',    '[]', 'negative', -0.5,    NULL),
    (2,  3,  'assistant', 'Thanks for being here, Maria. Where in NW Orange County do you spend most of your time?',                                                                                                                                                                                                                                                          'normal',    '[]', NULL,        NULL,   topic.t_geo),
    (3,  4,  'user',      'I live near Kelly Park Road in Apopka. Born and raised here — watched it change a lot.',                                                                                                                                                                                                                                                          'normal',    '[]', 'neutral',   0.0,    topic.t_geo),
    (4,  5,  'assistant', 'Kelly Park is actually one of the corridors the study has flagged as over capacity, with a funded improvement between Kelly Park Road and Waypo. What''s the biggest transportation frustration for you day-to-day?',                                                                                                                            'normal',    '[]', NULL,        NULL,   topic.t_frust),
    (5,  6,  'user',      'Morning rush is unbearable. And the school zone — kids walk in the road because there are NO sidewalks. It''s dangerous, and the county hasn''t done anything about it.',                                                                                                                                                                       'normal',    '[]', 'negative', -0.7,    topic.t_frust),
    (6,  7,  'assistant', 'Sidewalk gaps and school-zone safety are real concerns the study is tracking as ped/bike needs. NOWOCATS is also planning for what NW Orange County looks like in 2050 — what''s your biggest concern as the area grows?',                                                                                                                       'normal',    '[]', NULL,        NULL,   topic.t_growth),
    (7,  8,  'user',      'We''re losing the small-town feel. Too many subdivisions, not enough infrastructure to keep up. By 2030 it''ll be Disney-area sprawl out here.',                                                                                                                                                                                                  'normal',    '[]', 'negative', -0.6,    topic.t_growth),
    (8,  9,  'assistant', 'That tension between growth and character comes up often in the study area. NOWOCATS doesn''t approve subdivisions — it plans the transportation network that has to handle them. What kind of improvement do you think would help most: widening, new roads, safety, intersections, ped/bike, or transit?',                                  'normal',    '[]', NULL,        NULL,   topic.t_priority),
    (9,  10, 'user',      'Honestly, what''s the actual timeline on the Plymouth Sorrento widening? Is that really happening or just talk?',                                                                                                                                                                                                                                  'normal',    '[]', 'neutral',   0.0,    topic.t_road),
    (10, 11, 'assistant', 'That specific timeline isn''t something the study commits to — NOWOCATS identifies needs; the Local Planning Agency and Board of County Commissioners decide funding and schedules. I''ll log your question for the project team to follow up on. Back to the question though — which improvement type would help most for you?',           'normal',    '[]', NULL,        NULL,   topic.t_priority),
    (11, 12, 'user',      'Safety improvements at intersections, hands down. And honestly the trail system here is great — please don''t lose sight of that as you add roads.',                                                                                                                                                                                              'normal',    '[]', 'positive', 0.6,     topic.t_anchor_pri),
    (12, 13, 'assistant', 'Got it — safety at intersections as your top priority, with the trail network protected. Last quick one to get on the record: which best describes you — resident, business owner, commuter, or other?',                                                                                                                                          'normal',    '[]', NULL,        NULL,   topic.t_anchor_user),
    (13, 14, 'user',      'Resident. 30 years.',                                                                                                                                                                                                                                                                                                                              'normal',    '[]', 'neutral',   0.1,    topic.t_anchor_user)
  ) AS v(turn_offset, tn, role, content, src, flags, sentiment, score, tid)
) AS v;

-- Mirror to legacy bot_conversation_turns so admin readers that haven't
-- flipped READ_PHASE3 still see the demo.
INSERT INTO bot_conversation_turns (
  id, bot_id, session_id, turn_number, role, content, content_en, language, source,
  content_flags, sentiment, sentiment_score, created_at
)
SELECT
  gen_random_uuid(), c.bot_id, c.session_id, ct.turn_number, ct.role, ct.content, ct.content_en, ct.language, ct.source,
  ct.content_flags, ct.sentiment, ct.sentiment_score, ct.created_at
FROM conversation_turns ct
JOIN conversations c ON c.id = ct.conversation_id
WHERE c.session_id = 'bs_demo_nowocats_001'
ORDER BY ct.turn_number;

-- ── Insert one logged_questions row for the Plymouth Sorrento question ──
WITH q AS (
  SELECT ct.id AS turn_id, ct.conversation_id, c.bot_id, c.org_id, c.session_id, ct.content, ct.language
  FROM conversation_turns ct
  JOIN conversations c ON c.id = ct.conversation_id
  WHERE c.session_id = 'bs_demo_nowocats_001'
    AND ct.role = 'user'
    AND ct.turn_number = 10
)
INSERT INTO logged_questions (
  org_id, bot_id, session_id, conversation_id, turn_id,
  user_message, language, classification, status, created_at
)
SELECT
  q.org_id, q.bot_id, q.session_id, q.conversation_id, q.turn_id,
  q.content, q.language, 'ai_uncertain', 'open',
  now() - interval '1 hour 53 minutes'
FROM q;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────
SELECT 'conversation', (SELECT count(*) FROM conversations WHERE session_id='bs_demo_nowocats_001')
UNION ALL SELECT 'conversation_turns', (SELECT count(*) FROM conversation_turns ct JOIN conversations c ON c.id=ct.conversation_id WHERE c.session_id='bs_demo_nowocats_001')
UNION ALL SELECT 'town_hall_conversations link', (SELECT count(*) FROM town_hall_conversations thc JOIN conversations c ON c.id=thc.conversation_id WHERE c.session_id='bs_demo_nowocats_001')
UNION ALL SELECT 'bot_conversation_turns', (SELECT count(*) FROM bot_conversation_turns WHERE session_id='bs_demo_nowocats_001')
UNION ALL SELECT 'agent_session_personas (with name)', (SELECT count(*) FROM agent_session_personas WHERE session_id='bs_demo_nowocats_001' AND name='Maria')
UNION ALL SELECT 'logged_questions', (SELECT count(*) FROM logged_questions WHERE session_id='bs_demo_nowocats_001');
