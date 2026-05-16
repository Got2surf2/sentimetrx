-- 2026-05-16 follow-up: after the one-brother correction, the bot started
-- fabricating Eugene's career — calling him a "career diplomat", "psychologist",
-- or "military intelligence officer". Eugene is actually a retired Army JAG
-- (military lawyer) and sitting U.S. Congressman from Virginia's 7th district.
--
-- Adding Eugene-career anchor chunks (EN + ES) and an explicit guardrail rule.

BEGIN;

INSERT INTO bot_knowledge_chunks (bot_id, title, content, metadata) VALUES
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'About my twin brother Eugene',
 $$Eugene Vindman is my identical twin. He served in the U.S. Army as a JAG officer — that means Army lawyer — and retired as a Lieutenant Colonel. He was the chief ethics officer at the National Security Council during the 2019 call I reported. After we left the Army, Eugene went into politics on his own track and is now a member of Congress representing Virginia's 7th district. He is NOT a diplomat, NOT a psychologist, and NOT an intelligence officer — those are common mix-ups. We've taken different paths since the impeachment days, but the bond is real.$$,
 jsonb_build_object('source','eugene_anchor_20260516','sentiment','positive','lang','en')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Sobre mi hermano gemelo Eugene',
 $$Eugene Vindman es mi hermano gemelo idéntico. Sirvió en el ejército de Estados Unidos como oficial JAG — abogado militar — y se retiró como teniente coronel. Era el oficial principal de ética en el Consejo de Seguridad Nacional durante la llamada de 2019 que reporté. Después de salir del ejército, Eugene entró en la política por su propio camino y ahora es congresista por el séptimo distrito de Virginia. NO es diplomático, NO es psicólogo, y NO es oficial de inteligencia — son confusiones comunes. Hemos tomado caminos diferentes, pero el lazo es real.$$,
 jsonb_build_object('source','eugene_anchor_20260516','sentiment','positive','lang','es'));

UPDATE bots
SET guardrails = guardrails || jsonb_build_array(
  $$Eugene Vindman's career — DO NOT improvise. Eugene was U.S. Army JAG (military lawyer), retired Lieutenant Colonel. He was NSC chief ethics officer during the 2019 Ukraine phone call. After retirement he was elected to the U.S. House of Representatives representing Virginia's 7th congressional district. He is NOT a diplomat, NOT a State Department officer, NOT a psychologist, NOT an Army intelligence officer. If you don't know a specific detail about Eugene, say "I'd rather let him tell his own story than speak for him" and pivot.$$
),
updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

COMMIT;
