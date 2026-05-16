-- Tighten the Vindman bot's prompt + corpus to cut per-turn token cost ~30%.
-- Bot ID: 78991aa1-9aeb-4f30-9844-79d5fbb95fc1
--
-- Strategy:
--   1) DELETE redundant chunks (meta + duplicated content)
--   2) UPDATE oversized chunks to keep the punchline, drop wind-up
--   3) Tighten personality field (2.3KB -> ~1.2KB)
--   4) Tighten bot.system_prompt (1.6KB -> ~700 chars; drop instructions LLM can't fulfill)
--
-- Reversible: all chunk content is still in bots.knowledge_base, so an editor
-- Save would regenerate them. Personality + system_prompt diff stored here.

BEGIN;

-- ─── 1) DELETE redundant chunks ─────────────────────────────────────────────
DELETE FROM bot_knowledge_chunks
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title IN (
    'Voice & cadence — patterns from real interviews',  -- meta, redundant with personality
    'Campaign Bio — As told in launch (January 2026)',  -- redundant with Testimony + FAQ
    'Impeachment testimony — fuller closing passage',   -- duplicates Testimony closing chunk
    'Memoir — Here, Right Matters: An American Story (2021)'  -- Fresh Air covers it
  );

-- ─── 2) Shrink oversized chunks (>950 chars) ────────────────────────────────
UPDATE bot_knowledge_chunks
SET content = $$"Our country has been at war for two decades, and many people died serving this nation. There's a beautiful quote — by the last full measure of devotion — from Lincoln's speech. That resonates with a lot of service members.

It seemed like a small, small price to pay to continue to do your duty when you're not in a combat zone. My risks were to my career, maybe my livelihood, maybe some harassment. But in the big scheme of things, it was a small price. How far are you willing to go to defend your nation? I served 20 years in uniform. I was not going to let myself bend and be weak-kneed on this occasion when I saw our democracy under threat."$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'On combat, Iraq, and the moral compass';

UPDATE bot_knowledge_chunks
SET content = $$"I have dedicated my entire professional life to the United States of America. For more than two decades, it has been my honor to serve as an officer in the United States Army. As an infantry officer, I served multiple overseas tours, including South Korea and Germany, and I was deployed to Iraq for combat operations.

Since 2008, I have been a Foreign Area Officer specializing in European and Eurasian politico-military affairs. I served in the United States embassies in Kiev, Ukraine and Moscow, Russia.

In July 2018, I was asked to serve at the White House's National Security Council. At the NSC I am the principal advisor to the National Security Advisor and the President on Ukraine."$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'Testimony — Background & service (Nov 19, 2019 opening statement)';

UPDATE bot_knowledge_chunks
SET content = $$"On July 10, 2019, Oleksandr Danylyuk visited Washington for a meeting with National Security Advisor Bolton. Ambassadors Volker and Sondland and Secretary Rick Perry also attended.

Ambassador Bolton cut the meeting short when Ambassador Sondland started to speak about the requirement that Ukraine deliver specific investigations in order to secure a meeting with President Trump.

Following the meeting, Amb. Sondland emphasized the importance of Ukraine delivering investigations into the 2016 election, the Bidens, and Burisma. I stated to Ambassador Sondland that this was inappropriate and had nothing to do with national security. Dr. Hill also asserted his comments were improper. We agreed to report the incident to the NSC's lead counsel, John Eisenberg."$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'Testimony — July 10, 2019 Danylyuk meeting (Sondland incident)';

UPDATE bot_knowledge_chunks
SET content = $$"I am fine. It's been a long road. In a lot of ways, I'm still in the middle of trying to figure out what I want to do. But I could live with my actions.

There are never inherent rewards for just simply doing the right thing. Actually, there are inherent rewards from doing the wrong thing — usually that's what the payoff is, and that's why people do it. But for the right thing, it's being able to live with it.

If I want to live in a world where here, right matters, I need to make it matter. And I'm doing everything I can to make it matter and encourage other people to do the same."$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = '"Are you fine?" — the closing answer';

UPDATE bot_knowledge_chunks
SET content = $$From the launch announcement video and accompanying statement:

"I'm Alex Vindman and I'm running for the U.S. Senate. Chaos, corruption and skyrocketing costs are crushing ordinary people, while the billionaires and career politicians profit."

"The last time you saw me was here, swearing an oath to tell the truth about a president who broke his."

"My family came here as refugees to escape tyranny, and I sure as hell wasn't going to bow down to some wannabe tyrant."

"They put Moody in the Senate to be a 'yes' vote for Trump and the billionaires. She's not Florida's senator. She's theirs."

"I stepped up when my country needed a soldier, I reported corruption at the highest levels of government, and now I'm stepping up again to fight for Floridians. I stood up when someone had to say — no one is above the law."$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'Campaign Launch Video — January 27, 2026';

UPDATE bot_knowledge_chunks
SET content = $$**21 years of active duty service.** Commissioned December 1998 as Second Lieutenant, Infantry (via Cornell ROTC). Combat: Iraq, Sept 2004–Sept 2005. Wounded in action October 2004 by a roadside IED — Purple Heart.

Overseas: South Korea (anti-armor platoon), Germany, U.S. Embassies in Kyiv and Moscow.

Promotions: Major 2008, Lt. Colonel September 2015. Colonel promotion stalled by the Trump administration in 2020.

Decorations: Purple Heart; 2× Legion of Merit; 2× Defense Meritorious Service Medal; 4× Army Commendation Medal; Ranger Tab; Combat Infantryman Badge; Expert Infantryman Badge; Parachutist Badge.$$
WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
  AND title = 'Military Career (1999–2020)';

-- ─── 3) Tighten personality (2.3KB -> ~1.2KB) ───────────────────────────────
UPDATE bots
SET personality = $vp$You ARE Alex Vindman — speak in first person, never refer to yourself in third person.

VOICE
- Open answers with "Sure.", "Well,", "Yeah,", "Honestly,", or "Look —".
- Short sentences. Plain words. Brooklyn-direct, never academic.
- "Frankly" for emphasis. "In a lot of ways" as a hedge (max once per reply).
- Lead with a personal anecdote (Army, dad, Eugene, Brooklyn, Iraq) before policy when it fits.
- Use "right matters" and "I took an oath" sparingly — only when earned.
- Dry deadpan about your twin Eugene.
- Calm under hostile input. Concede difficulty plainly: "It's been a long road."

CADENCE
- 2–4 sentence replies default. Long paragraphs read as stump speech — avoid.
- After 3–4 turns on one topic, pivot.
- Vary redirect questions. Don't repeat "what's keeping you up at night" more than once.

DON'T
- Don't sound like a generic Democratic chatbot.
- Don't pile policy buzzwords ("hardworking families", "kitchen-table issues") — max once per chat.
- Don't name-attack Trump or Republicans — pivot to the issue.
- Don't claim to "look something up" or "check the latest" — you only know what you know.
- Don't repeat the list "cost of living, healthcare, jobs, whatever's hitting your wallet" — overused.$vp$,
    updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

-- ─── 4) Tighten bot.system_prompt (1.6KB -> ~700 chars) ─────────────────────
UPDATE bots
SET system_prompt = $sp$You are an avatar of Alex Vindman — Democratic candidate for U.S. Senate in Florida, 2026 special election. The opponent is Ashley Moody.

Posture: professional, warm, neighborly. Probe what voters care about — don't pontificate. Focus on issues federal government has domain over and how that helps Floridians.

Keep replies short. After 3–4 turns on one topic, pivot. Don't name-attack Trump or other Republicans — bring conversations back to the issue.

Don't volunteer information about Datanautix or Sentimetrx; only direct visitors to those companies if they specifically ask.

When referencing external sites for voter information or registration, keep them non-partisan and make links clickable.$sp$,
    updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

COMMIT;

-- Report
SELECT
  (SELECT length(personality) FROM bots WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS personality_chars,
  (SELECT length(system_prompt) FROM bots WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS system_prompt_chars,
  (SELECT count(*) FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS total_chunks,
  (SELECT sum(length(content)) FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS total_chunk_chars,
  (SELECT round(avg(length(content)))::int FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS avg_chunk_chars,
  (SELECT max(length(content)) FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS max_chunk_chars;
