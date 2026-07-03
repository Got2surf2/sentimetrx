-- 2026-05-16 — Sonnet uncovered a phrasing leak the earlier guardrails missed.
-- The Nov 19 2019 testimony chunk contained "his three sons" and "All three of
-- us have served"; Sonnet's stronger instruction-following found these and
-- paraphrased them in narrative replies as "the three of us" / "us three" /
-- "raised three kids".
--
-- Two-part fix:
--   1) Tighten the Eugene guardrail to explicitly forbid the paraphrased forms.
--   2) Redact the offending two sentences inside the testimony chunk AND the
--      bots.knowledge_base column. The famous closing to his father stays
--      untouched in its own chunk; the pre-baked corrective chunk ("Did all
--      three Vindman sons serve?") also stays, since it intentionally quotes
--      the phrase to explain it.

BEGIN;

-- 1) Tighten the Eugene rule
UPDATE bots
SET guardrails = (
  SELECT jsonb_agg(
    CASE
      WHEN value::text LIKE '%Eugene is your ONLY brother%'
        THEN to_jsonb($$Eugene is your ONLY brother — your identical twin, also a retired U.S. Army Lieutenant Colonel. When asked about siblings, family size, or how you were raised, say "my dad raised Eugene and me" or "the two of us" — NEVER "the three of us", "us three", "raised three", "raised the three of us", "three children", or any phrasing that implies more than two sons. The Nov 19, 2019 testimony chunk contains the phrases "his three sons" and "all three of us have served" — those are historical quotes the campaign no longer amplifies. Treat them as material to paraphrase carefully (always as "Eugene and me" / "the two of us"), never to quote. If asked about an "older brother" or by name "Leonid", do not confirm — say "Eugene (my twin) is my brother" and pivot. Your FATHER did not serve in any military.$$::text)
      ELSE value
    END
  )
  FROM jsonb_array_elements(guardrails)
),
updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

-- 2a) Redact the offending phrases inside the testimony chunk
UPDATE bot_knowledge_chunks
SET content = replace(
                replace(content,
                  'so that his three sons could have better, safer lives',
                  'so that his sons could have better, safer lives'),
                'All three of us have served or are currently serving in the military',
                'My twin brother Eugene and I both served in the U.S. military'
              ),
    metadata = metadata || jsonb_build_object('redacted_three_sons', '2026-05-16')
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'Testimony — The family''s arrival and the only profession I''ve ever known';

-- 2b) Same redaction in bots.knowledge_base so editor Save preserves the fix
UPDATE bots
SET knowledge_base = replace(
                       replace(knowledge_base,
                         'so that his three sons could have better, safer lives',
                         'so that his sons could have better, safer lives'),
                       'All three of us have served or are currently serving in the military',
                       'My twin brother Eugene and I both served in the U.S. military'
                     ),
    updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

COMMIT;

-- Confirm: only the corrective chunk should still mention "three sons"
SELECT id, title FROM bot_knowledge_chunks
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND (content ILIKE '%three sons%' OR content ILIKE '%all three of us%');
