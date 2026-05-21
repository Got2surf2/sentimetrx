-- Phase 6 verification — aggregate-only checks to confirm Phase 5
-- commits 1-4 actually land their data through to the new substrate
-- when both DUAL_WRITE_PHASE3=true AND TOWNHALL_VIA_AGENT_HANDLER=true.

SELECT
  (SELECT count(*) FROM town_halls WHERE slug = 'sarina-cohort') AS th_count,
  (SELECT count(*) FROM town_hall_topics tht JOIN town_halls th ON th.id = tht.town_hall_id WHERE th.slug = 'sarina-cohort') AS topics_count,
  (SELECT count(*) FROM conversations c JOIN town_hall_conversations thc ON thc.conversation_id = c.id JOIN town_halls th ON th.id = thc.town_hall_id WHERE th.slug = 'sarina-cohort') AS linked_conversations,
  (SELECT count(*) FROM conversation_turns ct JOIN conversations c ON c.id = ct.conversation_id JOIN town_hall_conversations thc ON thc.conversation_id = c.id JOIN town_halls th ON th.id = thc.town_hall_id WHERE th.slug = 'sarina-cohort') AS turns_in_cohort,
  (SELECT count(*) FROM conversation_turns ct JOIN conversations c ON c.id = ct.conversation_id JOIN town_hall_conversations thc ON thc.conversation_id = c.id JOIN town_halls th ON th.id = thc.town_hall_id WHERE th.slug = 'sarina-cohort' AND ct.topic_id IS NOT NULL) AS turns_tagged_with_topic,
  (SELECT count(DISTINCT c.participant_id) FROM conversations c JOIN town_hall_conversations thc ON thc.conversation_id = c.id JOIN town_halls th ON th.id = thc.town_hall_id WHERE th.slug = 'sarina-cohort' AND c.participant_id IS NOT NULL) AS distinct_participants;
