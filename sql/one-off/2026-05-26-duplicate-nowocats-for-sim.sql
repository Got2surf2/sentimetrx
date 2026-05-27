-- 2026-05-26 — Duplicate NOWOCATS PulseIQ into a sim copy and flip live.
--
-- Why: NOWOCATS launches early June for real PM-2 engagement. We want to
-- stress-test the agent + topic-rotation + threading with the NOWOCATS
-- persona pack (added to TownhallSimulatorClient.tsx today) without
-- co-mingling sim conversations into the real session's transcript.
--
-- This SQL creates a sibling town_halls row pointing at the same Sarina
-- agent (5c468b90), with status='live' so the simulator can join
-- immediately. Topics are deep-copied with the same response_target
-- defaults; conversations + turns are NOT copied (the sim will generate
-- its own).
--
-- After the sim run is reviewed, drop this copy with:
--   DELETE FROM town_halls WHERE slug='nowocats-sim';
-- (CASCADE removes the topics + linked conversations.)

DO $$
DECLARE
  source_id uuid := '0d1f97d3-134e-448f-9efb-0eb230812a4c';  -- NOWOCATS
  new_id uuid := gen_random_uuid();
  source_org uuid;
  source_bot uuid;
BEGIN
  -- 1. Clone the town_halls row.
  INSERT INTO public.town_halls (
    id, org_id, bot_id, slug, name, status,
    cohort_config, discussion_guide, response_target,
    started_at, created_by, created_at, updated_at
  )
  SELECT
    new_id,
    org_id,
    bot_id,
    'nowocats-sim',
    'NOWOCATS — SIMULATION (do not use for real PM-2 input)',
    'live',
    cohort_config,
    discussion_guide,
    response_target,
    now(),
    created_by,
    now(),
    now()
  FROM public.town_halls
  WHERE id = source_id;

  SELECT org_id, bot_id INTO source_org, source_bot
  FROM public.town_halls WHERE id = new_id;

  -- 2. Deep-copy topics. Keep source='seed' so the seed-on-activate path
  --    in the PATCH route doesn't try to re-seed if anyone toggles status
  --    later. Reset counters.
  INSERT INTO public.town_hall_topics (
    org_id, town_hall_id, label, description, question,
    follow_up_angles, keywords, state, source,
    response_target, response_count, mention_count,
    example_quote, sort_order,
    detected_at, approved_at, completed_at, created_at
  )
  SELECT
    source_org,
    new_id,
    label, description, question,
    follow_up_angles, keywords, state, source,
    response_target, 0, 0,
    NULL, sort_order,
    detected_at, approved_at, NULL, now()
  FROM public.town_hall_topics
  WHERE town_hall_id = source_id;

  RAISE NOTICE 'Sim copy created: % (slug=nowocats-sim, status=live)', new_id;
END $$;

-- Surface the new row + topic count for confirmation.
SELECT
  th.id, th.slug, th.name, th.status, th.bot_id,
  (SELECT count(*) FROM public.town_hall_topics WHERE town_hall_id = th.id) AS topic_count
FROM public.town_halls th
WHERE th.slug = 'nowocats-sim';
