-- 2026-05-22 — NOWOCATS demo: Sarina focuses + probe-focus + retroactive turn annotations
--
-- Without this pass, the demo conversation shows no per-turn topic
-- pills in the conversations modal — which buries the "AI annotates
-- every prompt + response" story that's a real credibility builder.
--
-- This script:
--   1. Authors Sarina's `focuses` catalog — 7 focuses mirroring the
--      NOWOCATS discussion_guide topics. Slugs match for clean
--      visual correlation between facilitator dashboard topics and
--      per-turn focus tags.
--   2. Enables `probe_focus_enabled` so NEW user turns going forward
--      get auto-tagged with topic:<slug> by lib/probeFocusClassifier
--      (~1 Haiku call per user turn ≥3 words — negligible for cohort
--      traffic).
--   3. Retroactively tags the 14 Maria demo turns with content_flags
--      that approximate what the live classifiers would produce:
--      focus:<slug> on assistant turns (what the bot covered),
--      topic:<slug> on user turns (what the user talked about).
--
-- Per-turn tags map cleanly to the conversation flow so the modal
-- displays the matched/mismatched-analysis story:
--   - matched: focus:biggest_frustration (T5) ↔ topic:biggest_frustration (T6) ✓
--   - matched: focus:growth_concerns_2050 (T7) ↔ topic:growth_concerns_2050 (T8) ✓
--   - mismatched: focus:priority_improvement (T9) → topic:specific_road... (T10)
--     [Maria pivoted from "which improvement" to asking about Plymouth Sorrento]
--
-- Idempotent. Re-running overwrites in place.

BEGIN;

-- ── 1. Sarina focuses catalog + probe-focus enabled ──────────────
UPDATE agents
SET
  focuses = jsonb_build_array(
    jsonb_build_object('slug', 'who_they_are',                    'label', 'Who they are',                'description', 'Resident, business owner, commuter, visitor — including length of tenure.', 'enabled', true),
    jsonb_build_object('slug', 'where_in_nw_orange',              'label', 'Where in NW Orange County',   'description', 'Specific geography — town, neighborhood, corridor — where this person lives, works, or travels.', 'enabled', true),
    jsonb_build_object('slug', 'how_they_get_around',             'label', 'How they get around',         'description', 'Primary mode of travel — drive, transit, bike, walk, mix.', 'enabled', true),
    jsonb_build_object('slug', 'biggest_frustration',             'label', 'Biggest frustration',         'description', 'Day-to-day transportation pain points: congestion, school zones, sidewalks, safety, signals, crashes.', 'enabled', true),
    jsonb_build_object('slug', 'growth_concerns_2050',            'label', 'Growth concerns (2050)',      'description', 'How residents feel about projected growth, sprawl, character preservation, environmental impact through the study horizon.', 'enabled', true),
    jsonb_build_object('slug', 'priority_improvement',            'label', 'Priority improvement',        'description', 'Which improvement type they prioritize: widening, new roads, safety, intersections, ped/bike, transit.', 'enabled', true),
    jsonb_build_object('slug', 'specific_road_or_intersection',   'label', 'Specific road or intersection', 'description', 'A concrete location — corridor, intersection, school zone, neighborhood — the participant wants on the project team radar.', 'enabled', true)
  ),
  probe_focus_enabled = true,
  updated_at = now()
WHERE id = '5c468b90-13fc-46a2-8855-312dc0a1e428';

-- ── 2. Retroactive content_flags on the demo turns ───────────────
-- Update by (conversation_id, turn_number) so the same data lands in
-- both substrates' tables. Tags chosen to look like real classifier
-- output, with one intentional "mismatched" pair (T9 focus = priority,
-- T10 topic = specific_road) to showcase the diff capability.

-- Helper expression: conversation_id for the demo conversation
-- inline subqueried each UPDATE so this script is self-contained.

-- Phase-3 (conversation_turns)
WITH demo AS (
  SELECT id AS conversation_id
  FROM conversations
  WHERE session_id = 'bs_demo_nowocats_001'
)
UPDATE conversation_turns ct
SET content_flags = updates.flags::jsonb
FROM demo, (VALUES
  ( 1, '[]'),
  ( 2, '["topic:biggest_frustration"]'),
  ( 3, '["focus:where_in_nw_orange"]'),
  ( 4, '["topic:where_in_nw_orange","topic:specific_road_or_intersection"]'),
  ( 5, '["focus:specific_road_or_intersection","focus:biggest_frustration"]'),
  ( 6, '["topic:biggest_frustration"]'),
  ( 7, '["focus:biggest_frustration","focus:growth_concerns_2050"]'),
  ( 8, '["topic:growth_concerns_2050"]'),
  ( 9, '["focus:growth_concerns_2050","focus:priority_improvement"]'),
  (10, '["topic:specific_road_or_intersection"]'),
  (11, '["focus:priority_improvement","focus:specific_road_or_intersection"]'),
  (12, '["topic:priority_improvement"]'),
  (13, '["focus:priority_improvement","focus:who_they_are"]'),
  (14, '["topic:who_they_are"]')
) AS updates(tn, flags)
WHERE ct.conversation_id = demo.conversation_id AND ct.turn_number = updates.tn;

-- Legacy (bot_conversation_turns) — mirror via session_id
UPDATE bot_conversation_turns bct
SET content_flags = updates.flags::jsonb
FROM (VALUES
  ( 1, '[]'),
  ( 2, '["topic:biggest_frustration"]'),
  ( 3, '["focus:where_in_nw_orange"]'),
  ( 4, '["topic:where_in_nw_orange","topic:specific_road_or_intersection"]'),
  ( 5, '["focus:specific_road_or_intersection","focus:biggest_frustration"]'),
  ( 6, '["topic:biggest_frustration"]'),
  ( 7, '["focus:biggest_frustration","focus:growth_concerns_2050"]'),
  ( 8, '["topic:growth_concerns_2050"]'),
  ( 9, '["focus:growth_concerns_2050","focus:priority_improvement"]'),
  (10, '["topic:specific_road_or_intersection"]'),
  (11, '["focus:priority_improvement","focus:specific_road_or_intersection"]'),
  (12, '["topic:priority_improvement"]'),
  (13, '["focus:priority_improvement","focus:who_they_are"]'),
  (14, '["topic:who_they_are"]')
) AS updates(tn, flags)
WHERE bct.session_id = 'bs_demo_nowocats_001' AND bct.turn_number = updates.tn;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────
SELECT
  'agents.focuses count' AS check, jsonb_array_length(focuses)::text AS value
FROM agents WHERE id='5c468b90-13fc-46a2-8855-312dc0a1e428'
UNION ALL SELECT
  'agents.probe_focus_enabled', probe_focus_enabled::text
FROM agents WHERE id='5c468b90-13fc-46a2-8855-312dc0a1e428'
UNION ALL SELECT
  'turns with topic: tag (user)', count(*)::text
FROM conversation_turns ct
JOIN conversations c ON c.id=ct.conversation_id
WHERE c.session_id='bs_demo_nowocats_001'
  AND ct.role='user'
  AND ct.content_flags::text LIKE '%topic:%'
UNION ALL SELECT
  'turns with focus: tag (assistant)', count(*)::text
FROM conversation_turns ct
JOIN conversations c ON c.id=ct.conversation_id
WHERE c.session_id='bs_demo_nowocats_001'
  AND ct.role='assistant'
  AND ct.content_flags::text LIKE '%focus:%'
UNION ALL SELECT
  'legacy mirror — turns with topic: tag (user)', count(*)::text
FROM bot_conversation_turns
WHERE session_id='bs_demo_nowocats_001'
  AND role='user'
  AND content_flags::text LIKE '%topic:%';
