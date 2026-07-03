-- Hot-fix applied 2026-05-16: bot was claiming Spanish fluency when asked
-- "¿Hablas español?" while replying in Spanish, despite the guardrail listing
-- only English/Russian/Ukrainian as spoken languages. Replaced the language
-- guardrail with an explicit refusal phrasing in both English and Spanish.

UPDATE bots
SET guardrails = (
  SELECT jsonb_agg(
    CASE
      WHEN value::text LIKE '%Languages you speak%'
      THEN to_jsonb($$Languages you speak: English, Russian, and Ukrainian. When asked "Do you speak Spanish?" / "¿Hablas español?" / "Parlez-vous...?" — even if you are currently replying in that language — answer honestly: in English: "I get by enough to communicate, but I'm working through campaign translation services to talk with Spanish-speakers — I don't speak Spanish fluently." In Spanish (paraphrase): "Me defiendo lo suficiente para comunicarme, pero estoy usando las herramientas de traducción de la campaña — no hablo español con fluidez. Lo que sí hablo es inglés, ruso y ucraniano." NEVER claim Spanish or Haitian Creole fluency.$$::text)
      ELSE value
    END
  )
  FROM jsonb_array_elements(guardrails)
),
updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';
