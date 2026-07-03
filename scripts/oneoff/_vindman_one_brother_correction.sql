-- 2026-05-16 correction: campaign says Eugene (identical twin) is Alex's ONLY brother.
-- Pre-existing secondary research had named an "older brother Leonid" — scrubbing that
-- everywhere I propagated it this session, plus the original Background chunk.
--
-- LEAVING the Nov 19 2019 sworn testimony chunk intact even though it contains the
-- phrases "his three sons" and "all three of us have served" — that is a verbatim
-- primary source quote and editing it would be silently rewriting the public record.
-- Compensating with a new guardrail telling the bot how to paraphrase, never quote.

BEGIN;

-- 1) Patch guardrails: drop Leonid from rule #2, replace the "three sons" rule with
--    an Eugene-only rule + paraphrase instruction for the testimony chunk
UPDATE bots
SET guardrails = (
  SELECT jsonb_agg(
    CASE
      WHEN value::text LIKE '%older brother Leonid%'
        THEN to_jsonb($$Your father immigrated in December 1979 at age 47, bringing you and your identical twin Eugene to Brooklyn, New York. Your biological mother died of cancer when you were about 3 years old. That was a key driver of leaving the Soviet Union, alongside corruption and institutionalized antisemitism.$$::text)
      WHEN value::text LIKE '%All three Vindman SONS%'
        THEN to_jsonb($$Eugene is your ONLY brother — your identical twin, also a retired U.S. Army Lieutenant Colonel. When asked about siblings or family military service, say "my twin brother Eugene and I both served." DO NOT say "three sons", "all three of us", or name an "older brother Leonid" — even though the Nov 19, 2019 testimony chunk in your knowledge base contains those phrases. If asked about an "older brother" or by name "Leonid", do not confirm or deny — say "Eugene (my twin) is my brother" and pivot. Your FATHER did not serve in any military.$$::text)
      ELSE value
    END
  )
  FROM jsonb_array_elements(guardrails)
),
-- 2) Drop the Leonid fact from bots.facts
facts = (
  SELECT jsonb_agg(value)
  FROM jsonb_array_elements(facts) AS value
  WHERE value::text NOT LIKE '%Leonid%'
),
-- 3) Scrub the original Background research from knowledge_base
knowledge_base = replace(knowledge_base, 'identical twin brother Eugene and older brother Leonid', 'identical twin brother Eugene'),
updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

-- 4) Patch the original Background chunk (secondary research, predates this session)
UPDATE bot_knowledge_chunks
SET content = replace(content, 'identical twin brother Eugene and older brother Leonid', 'identical twin brother Eugene'),
    metadata = metadata || jsonb_build_object('patched_one_brother_correction', '2026-05-16')
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND content LIKE '%older brother Leonid%';

COMMIT;

-- Report
SELECT
  (SELECT count(*) FROM bot_knowledge_chunks
     WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
       AND content ILIKE '%Leonid%') AS chunks_still_naming_leonid,
  (SELECT count(*) FROM bot_knowledge_chunks
     WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
       AND content ILIKE '%three sons%') AS chunks_with_testimony_three_sons,
  (SELECT jsonb_array_length(guardrails) FROM bots
     WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS guardrails,
  (SELECT jsonb_array_length(facts) FROM bots
     WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS facts,
  (SELECT (knowledge_base ILIKE '%Leonid%') FROM bots
     WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS kb_still_names_leonid;
