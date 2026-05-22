-- 2026-05-22 — NOWOCATS town_halls row (first PulseIQ town hall on the
-- new substrate). Points at Sarina (live agent
-- 5c468b90-13fc-46a2-8855-312dc0a1e428). Launch window: early June 2026.
--
-- ── DO NOT RUN UNTIL ALL OF THE BELOW ARE CONFIRMED ──────────────────
--   1. slug `nowocats` is the desired public URL slug (would expose
--      `/th/nowocats` to participants). Alternative: `nowocats-pm2`,
--      `nowocats-2026`, etc. Edit line ~50 if so.
--   2. cohort_config.opening_message + closing_message wording is what
--      the project team wants (drafted from `[[nowocats-survey]]` deck
--      slide 5 + a neutral closing). Edit lines ~60-70 to refine.
--   3. cohort_config.languages = ['en','es'] per deck slide 9. Add more
--      if the project supports them (Sarina's bot config doesn't enforce
--      a fixed set; the town hall config drives the picker).
--   4. discussion_guide topics + anchor asks match the v1 substance the
--      client signed off on per `[[nowocats-survey]]` slide 7. Edit if
--      the v1 has shifted since 2026-05-16.
--   5. content_safety profile is the default-on setup. NOWOCATS is a
--      public-record forum; recommend leaving as-is.
--
-- Status is 'draft' so the facilitator dashboard can review + flip to
-- 'live' via the Session Controls top bar (this also populates
-- started_at server-side). DO NOT change to 'live' in this SQL unless
-- the launch is happening right now.
--
-- Idempotent on slug via the town_halls_slug_idx unique index +
-- ON CONFLICT DO NOTHING. Re-running is a no-op. Editing this file
-- and re-running will NOT update an existing row — drop it first
-- (`DELETE FROM town_halls WHERE slug='nowocats';`) and re-run if you
-- need to change config before the dashboard exists.

BEGIN;

INSERT INTO town_halls (
  org_id, bot_id, slug, name, status,
  cohort_config, discussion_guide, response_target
)
SELECT
  a.org_id,
  a.id,
  'nowocats',
  'NOWOCATS — Northwest Orange County Area Transportation Study (PM-2)',
  'draft',
  -- cohort_config — projected by lib/townHallAdapter.ts into the
  -- legacy session.config shape on read.
  jsonb_build_object(
    'bot_name',                              'Sarina, the NOWOCATS Assistant',
    'bot_emoji',                             '🚦',
    'industry',                              'Government / Civic',
    'session_type',                          'community',
    'context', jsonb_build_object(
      'org_name',                            'VHB / Orange County Public Works',
      'event_description',                   'NOWOCATS is the Northwest Orange County Area Transportation Study — a long-range plan identifying transportation needs for NW Orange County (including Apopka, Ocoee, Winter Garden, and surrounding unincorporated areas) through 2050. This is the PM-2 public engagement phase: gathering resident, business, and commuter input that feeds into the Final Study Report.',
      'tone',                                'Helpful, neighborly, plain-spoken — like a community-meeting moderator, not a planner on a panel.',
      'sensitive_topics',                    jsonb_build_array(),
      'priority_areas',                      jsonb_build_array('widening', 'new roads', 'safety', 'intersections', 'pedestrian/bike', 'transit')
    ),
    'opening_message',                       'Hi — I''m Sarina, the NOWOCATS Assistant. What''s your first name? And are you here to learn about the study, or share your thoughts?',
    'closing_message',                       'Thanks so much for taking the time. Your input is part of the official PM-2 record and will help shape the Final Study Report. The full project record stays at www.nowocats.com — feel free to come back anytime as the study moves forward.',
    'languages',                             jsonb_build_array('en', 'es'),
    'engine', jsonb_build_object(
      'theme_detection_mode',                'auto',
      'theme_detection_interval_minutes',    15,
      'theme_detection_every_n_responses',   20,
      'max_turns_per_participant',           30,
      'default_response_target',             30,
      'max_active_themes',                   16,
      'ai_timeout_ms',                       20000
    ),
    'session_end', jsonb_build_object(
      'mode',                                'manual',
      'duration_minutes',                    null,
      'inactivity_timeout_minutes',          null
    ),
    'display', jsonb_build_object(
      'skip_label',                          'Skip',
      'done_label',                          'Done'
    ),
    'messages', jsonb_build_object(
      'post_session_intro',                  'Almost done — a couple of quick optional questions to help us understand who we heard from today.',
      'post_session_demo',                   'A couple of optional questions about you (all optional).',
      'post_session_thanks',                 'Thanks for sharing! Your input helps us understand our community better.'
    ),
    'questionPosition',                      'after',
    'demoFields',                            jsonb_build_array(),
    'psychographicBank',                     jsonb_build_array(),
    'psychoCount',                           0,
    'testing',                               false,
    'header_color',                          '#1565C0',
    'content_safety', jsonb_build_object(
      'enabled',                             true,
      'profanity',                           true,
      'slurs',                               true,
      'threats',                             true,
      'sexual',                              true,
      'insults',                             true,
      'spam',                                true
    ),
    -- Phase-3 specific: standby message when pickNextTopic returns
    -- all_covered. Used by handleChatTurn (Phase 5 commit 4).
    'standby_message',                       'Thanks for sharing — that''s really helpful for the project team. We''ve covered the topics on our list, so I''ll let you go. If something else comes to mind, feel free to come back to www.nowocats.com anytime.'
  ),
  -- discussion_guide — 7 conversational topics + 2 anchor asks per
  -- `[[nowocats-survey]]` deck slide 7. Anchor asks are tagged in the
  -- description so the facilitator sees them as required-before-closing
  -- in the dashboard. Sarina's system prompt is the actual enforcer of
  -- anchor-ask logic — these rows give the dashboard topics to track
  -- response counts against.
  jsonb_build_array(
    -- 7 conversational topics
    jsonb_build_object(
      'id',                 'who_they_are',
      'label',              'Who they are',
      'description',        'Whether the participant is a resident, business owner, commuter, or other — same data as anchor ask A1 but inferred conversationally when possible.',
      'opening_question',   'Just to put your input in context — do you live in NW Orange County, work there, or both?',
      'follow_up_angles',   jsonb_build_array('How long have you been in the area?', 'Which town or neighborhood?'),
      'keywords',           jsonb_build_array('resident', 'live', 'home', 'business', 'work', 'commute', 'commuter', 'visitor'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'where_in_nw_orange',
      'label',              'Where in NW Orange County',
      'description',        'Specific geography — town, neighborhood, corridor — where this person lives, works, or travels.',
      'opening_question',   'Whereabouts in NW Orange County do you spend most of your time?',
      'follow_up_angles',   jsonb_build_array('Apopka? Ocoee? Winter Garden? Somewhere unincorporated?', 'Do you cross between towns often?'),
      'keywords',           jsonb_build_array('apopka', 'ocoee', 'winter garden', 'plymouth', 'clarcona', 'lake', 'tangerine', 'neighborhood', 'subdivision', 'unincorporated'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'how_they_get_around',
      'label',              'How they get around',
      'description',        'Primary mode of travel — drive, transit, bike, walk, mix.',
      'opening_question',   'How do you mostly get around — driving, transit, biking, walking?',
      'follow_up_angles',   jsonb_build_array('What about for shorter trips?', 'Anyone else in the household have different needs?'),
      'keywords',           jsonb_build_array('drive', 'driving', 'car', 'transit', 'bus', 'lynx', 'bike', 'walk', 'rideshare', 'uber', 'lyft'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'biggest_frustration',
      'label',              'Biggest transportation frustration',
      'description',        'What about transportation in NW Orange County frustrates this person most today.',
      'opening_question',   'What''s the biggest transportation frustration you deal with today?',
      'follow_up_angles',   jsonb_build_array('Where exactly is that happening?', 'How often does it cost you time?', 'Has it changed in the last few years?'),
      'keywords',           jsonb_build_array('traffic', 'congestion', 'backup', 'stoplight', 'school zone', 'rush hour', 'crash', 'accident', 'pothole', 'crossing'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'growth_concerns_2050',
      'label',              'Growth concerns (2050 outlook)',
      'description',        'How this person feels about projected growth in the study area through 2050 — the build vs. no-build context the study weighs.',
      'opening_question',   'NOWOCATS is planning for what NW Orange County looks like in 2050. What''s your biggest concern as the area grows?',
      'follow_up_angles',   jsonb_build_array('Schools, infrastructure, character of the area, environment?', 'Any specific corridor you''re worried about?'),
      'keywords',           jsonb_build_array('growth', 'growing', 'development', '2050', 'sprawl', 'density', 'character', 'environment', 'wekiva', 'rural', 'schools'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'priority_improvement',
      'label',              'Top priority improvement',
      'description',        'Same data as anchor ask A2 but ideally surfaced conversationally before the explicit ask.',
      'opening_question',   'If you could pick the one type of improvement that would help most — widening, new roads, safety, intersections, ped/bike, transit — which would it be?',
      'follow_up_angles',   jsonb_build_array('Why that one over the others?', 'Anywhere specific where you''d want to see it?'),
      'keywords',           jsonb_build_array('widening', 'new road', 'safety', 'intersection', 'roundabout', 'signal', 'pedestrian', 'bike', 'sidewalk', 'transit', 'bus rapid transit'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'specific_road_or_intersection',
      'label',              'Specific road or intersection to flag',
      'description',        'A concrete location (corridor, intersection, school zone, neighborhood) the participant wants on the project team''s radar.',
      'opening_question',   'Is there a specific intersection or stretch of road you''d want the project team to look at?',
      'follow_up_angles',   jsonb_build_array('What time of day is it worst?', 'Have you reported it to anyone before?'),
      'keywords',           jsonb_build_array('us 441', 'orange blossom trail', 'clarcona-ocoee', 'kelly park', 'welch', 'ponkan', 'mccormick', 'plymouth sorrento', 'rock springs', 'wekiwa springs', 'clarcona', 'apopka-vineland', 'sadler'),
      'response_target',    30,
      'enabled',            true
    ),
    -- 2 anchor asks (REQUIRED before closing per deck slide 7)
    jsonb_build_object(
      'id',                 'anchor_user_type',
      'label',              'ANCHOR — User type (required before close)',
      'description',        'Demographic cross-tab anchor — every participant gets this explicit ask before close if not already surfaced via the conversational "who they are" topic.',
      'opening_question',   'Before you go — which best describes you: resident, business owner, commuter, or other?',
      'follow_up_angles',   jsonb_build_array(),
      'keywords',           jsonb_build_array('resident', 'business owner', 'commuter', 'other'),
      'response_target',    30,
      'enabled',            true
    ),
    jsonb_build_object(
      'id',                 'anchor_priority_category',
      'label',              'ANCHOR — Priority category (required before close)',
      'description',        'Maps directly to VHB Final Study Report buckets. Every participant gets this explicit ask before close if not already surfaced via the conversational "top priority improvement" topic.',
      'opening_question',   'And of these six — widening, new roads, safety, intersections, ped/bike, transit — which would make the biggest difference for you?',
      'follow_up_angles',   jsonb_build_array(),
      'keywords',           jsonb_build_array('widening', 'new roads', 'safety', 'intersections', 'pedestrian/bike', 'ped/bike', 'transit'),
      'response_target',    30,
      'enabled',            true
    )
  ),
  -- response_target: dashboard's overall cohort response target. NOWOCATS
  -- is a broader public-engagement push than a small cohort discussion;
  -- 300 is a reasonable v1 ceiling. The seed topics each have their own
  -- response_target inside discussion_guide above.
  300
FROM agents a
WHERE a.id = '5c468b90-13fc-46a2-8855-312dc0a1e428'   -- Sarina
ON CONFLICT (slug) DO NOTHING;

-- Seed topics — copy each discussion_guide entry into town_hall_topics
-- so the facilitator dashboard renders them immediately + the chat
-- handler (handleChatTurn → pickNextTopic) has topics to assign turns
-- to from turn 1.
--
-- Normally handlePhase3Patch (PATCH .../sessions/[id] with status=active)
-- does the seed-on-activate. But because we want the dashboard to show
-- the topic list BEFORE the facilitator clicks "Start", seed them now
-- as state='active' so they're visible in draft mode too. Re-activating
-- later is idempotent: the seed-on-activate block in handlePhase3Patch
-- checks `existingSeed` count first and skips if any seed rows exist.

INSERT INTO town_hall_topics (
  org_id, town_hall_id, label, description, question,
  follow_up_angles, keywords, source, state, response_target, sort_order
)
SELECT
  t.org_id,
  t.id,
  (g->>'label')::text,
  (g->>'description')::text,
  (g->>'opening_question')::text,
  ARRAY(SELECT jsonb_array_elements_text(g->'follow_up_angles')),
  ARRAY(SELECT jsonb_array_elements_text(g->'keywords')),
  'seed',
  'active',
  COALESCE((g->>'response_target')::int, 30),
  idx - 1
FROM town_halls t
CROSS JOIN LATERAL jsonb_array_elements(t.discussion_guide) WITH ORDINALITY AS gw(g, idx)
WHERE t.slug = 'nowocats'
  AND NOT EXISTS (
    SELECT 1 FROM town_hall_topics x
    WHERE x.town_hall_id = t.id AND x.label = (g->>'label')::text
  );

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────
SELECT 'town_halls row',
  CASE WHEN EXISTS (SELECT 1 FROM town_halls WHERE slug='nowocats') THEN 'ready' ELSE 'MISSING' END,
  (SELECT count(*)::text FROM town_halls WHERE slug='nowocats') AS count
UNION ALL
SELECT 'seed topics',
  CASE WHEN (SELECT count(*) FROM town_hall_topics tht JOIN town_halls th ON th.id=tht.town_hall_id WHERE th.slug='nowocats') >= 9 THEN 'ready' ELSE 'MISSING' END,
  (SELECT count(*)::text FROM town_hall_topics tht JOIN town_halls th ON th.id=tht.town_hall_id WHERE th.slug='nowocats')
UNION ALL
SELECT 'status is draft (intentional — flip to live via dashboard)',
  (SELECT status FROM town_halls WHERE slug='nowocats'),
  ''
UNION ALL
SELECT 'bot_id points at Sarina',
  CASE WHEN (SELECT bot_id FROM town_halls WHERE slug='nowocats') = '5c468b90-13fc-46a2-8855-312dc0a1e428'::uuid THEN 'ready' ELSE 'MISMATCH' END,
  (SELECT bot_id::text FROM town_halls WHERE slug='nowocats');

-- ── Post-insert checklist (manual) ───────────────────────────────────
-- 1. Visit /townhall in the dashboard. The "NOWOCATS — Northwest Orange
--    County Area Transportation Study (PM-2)" row should appear in the
--    list.
-- 2. Click in. Topics tab should show 9 topics (7 conversational + 2
--    ANCHOR — visible as 'ANCHOR' prefix in the label).
-- 3. Review the opening + closing messages. Edit via the Session Edit
--    UI if any wording is off — they live in town_halls.cohort_config.
-- 4. When ready to go live: click Start in the top bar. Status flips
--    to 'live' + started_at populates. The /th/nowocats participant URL
--    becomes active.
-- 5. Confirm prod env flags are flipped BEFORE the first participant
--    arrives:
--      - TOWNHALL_VIA_AGENT_HANDLER=true   (chat routes through chatCore)
--      - DUAL_WRITE_PHASE3=true            (bot_conversation_turns dual-write)
--    Without these, the new path is dark and /api/townhall/chat runs the
--    legacy orchestrator (which doesn't know about town_halls rows).
