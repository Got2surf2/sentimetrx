-- Question Log smoke check — aggregate-only.
SELECT
  count(*) AS total_logged,
  count(*) FILTER (WHERE classification = 'deflect') AS deflect_count,
  count(*) FILTER (WHERE classification = 'kb_miss') AS kb_miss_count,
  count(*) FILTER (WHERE classification = 'ai_uncertain') AS ai_uncertain_count
FROM logged_questions
WHERE bot_id = '5c468b90-13fc-46a2-8855-312dc0a1e428'
  AND created_at > now() - interval '10 minutes';
