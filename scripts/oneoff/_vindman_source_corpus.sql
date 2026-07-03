-- Tier-1 source corpus for the Alex Vindman demo bot.
-- Bot ID: 78991aa1-9aeb-4f30-9844-79d5fbb95fc1
-- Sources (all public, journalistic / candidate-owned):
--   * Florida First Agenda — alexvindman.com/florida-first-agenda/ (his campaign site, verbatim)
--   * Campaign launch (Jan 27 2026) — direct quotes reproduced in NBC, Fox, WaPo, Axios, WashEx
--   * House Intel Committee testimony (Nov 19 2019) — quotes reproduced in PBS, NPR, CNN, TPM, Rev
-- All chunks tagged metadata.source='source_corpus_20260515' for traceability + reversibility.

BEGIN;

INSERT INTO bot_knowledge_chunks (bot_id, title, content, metadata) VALUES

-- ─── Florida First Agenda (7 priorities, verbatim from his site) ─────────────
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Cut Costs and Stand Up for Hardworking People',
 $$Costs are totally out of control. Florida needs a Senator who will cut costs and address groceries, gas, utility bills, and insurance premiums. My agenda: tax relief for middle-class families, make the tax system fair, close loopholes for tax cheats, and impose transparency measures against corporate price gouging. Invest in public education, the trades, small business, and building a 21st-century economy with good-paying jobs.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Crush Corruption',
 $$I will ban insider trading by members of Congress and send violators to jail. Crack down on dark money in elections. Strengthen ethics laws with real consequences. Expand congressional oversight and investigatory authorities. Reject corporate PAC money. Repeal Citizens United to limit dark money's influence in American politics.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — End the Florida Home Insurance Crisis',
 $$I will increase market competition among insurers, hold them accountable for spiking rates, and address the underlying risks driving premiums. Smart investments in resilience and disaster mitigation protect communities and keep costs down long-term.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Make Housing More Affordable',
 $$Renters in Florida pay roughly 38% of their monthly income on rent. I will cut red tape slowing construction, support policies that help first-time homebuyers, and take on corporate investors who treat housing as a speculative asset.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Ensure Affordable Healthcare and Prescription Drugs',
 $$Defend and strengthen the Affordable Care Act. Lower drug prices. Expand access to quality care. Increase funding for addiction services. Add dental and eye coverage to Medicare. Expand Medicaid and Medicare access programs. I oppose Big Pharma's practices in the opioid crisis and the overpricing of medicines.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Invest in Strong Public Schools',
 $$Invest in teachers, modern classrooms, and career and technical education. I oppose defunding or politicizing public education at the federal or local level.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Florida First Agenda — Steady Foreign Policy',
 $$As a 21-year Army veteran wounded in Iraq, I oppose forever wars that waste resources while Florida families struggle at home. Defend American interests, support allies, prioritize cost-effective policy. Increase VA funding. Support veterans with job training, affordable housing, and transition programs.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com/florida-first-agenda/','sentiment','positive')),

-- ─── Campaign launch video — Jan 27 2026 (quotes reproduced in NBC, WaPo, Axios, WashEx, Fox) ─────────────
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Campaign Launch Video — January 27, 2026',
 $$From the launch announcement video and accompanying statement:

"I'm Alex Vindman and I'm running for the U.S. Senate. Chaos, corruption and skyrocketing costs are crushing ordinary people, while the billionaires and career politicians profit."

"The last time you saw me was here, swearing an oath to tell the truth about a president who broke his."

"See, my family came here as refugees to escape tyranny, and I sure as hell wasn't going to bow down to some wannabe tyrant."

"This president unleashed a reign of terror and retribution, not just against me and my family, but against all of us."

"Today, our country is in chaos. Thug militias attacking citizens. Tariffs pushing prices sky-high. Health care premiums through the roof."

"They put Moody in the Senate to be a 'yes' vote for Trump and the billionaires. She's not Florida's senator. She's theirs."

"I stepped up when my country needed a soldier, I reported corruption at the highest levels of government, and now I'm stepping up again to fight for Floridians."

"I stood up when someone had to say — no one is above the law."$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','launch_video','date','2026-01-27','sentiment','positive')),

-- ─── Impeachment testimony — Nov 19 2019 ─────────────
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'House Impeachment Testimony — November 19, 2019 (Opening Statement)',
 $$From the prepared opening statement Vindman delivered to the House Intelligence Committee:

"I have dedicated my entire professional life to the United States of America."

On the July 25, 2019 Trump–Zelensky call: "It is improper for the President of the United States to demand a foreign government investigate a U.S. citizen and political opponent."

Speaking to his father, who watched from the audience: "Dad, my sitting here today, in the U.S. Capitol talking to our elected officials, is proof that you made the right decision forty years ago to leave the Soviet Union and come here to the United States of America in search of a better life for our family. Do not worry, I will be fine for telling the truth."

On the family's military service: All three Vindman brothers have served or currently serve in the U.S. military, making military service "a special part of our family's history and story in America."

Vindman noted that in countries like Russia, "offering public testimony involving the President would surely cost me my life." He thanked the country for the freedom to speak the truth without fear.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','testimony','date','2019-11-19','url','https://www.pbs.org/newshour/politics/read-alexander-vindmans-opening-statement-in-the-trump-public-impeachment-hearing','sentiment','positive')),

-- ─── Memoir + framing chunk ─────────────
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Memoir — Here, Right Matters: An American Story (2021)',
 $$"Here, Right Matters: An American Story" is Vindman's memoir, published by Harper in August 2021. The title comes from his father's words before his impeachment testimony — Don't worry, Alex; right matters here — and the book traces his journey from refugee child in Brooklyn through his Army career, deployment to Iraq, work at the National Security Council, and the choice to testify. Core themes: duty, the immigrant's faith in American institutions, and the cost of doing the right thing.

Vindman has framed the title in interviews this way: in America, unlike the country his family left, right is supposed to matter — and his testimony was an attempt to prove that still true.$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','memoir_meta','sentiment','positive')),

-- ─── Bio amplification from launch coverage ─────────────
('78991aa1-9aeb-4f30-9844-79d5fbb95fc1',
 'Campaign Bio — As told in launch (January 2026)',
 $$From the campaign site and launch coverage:

Lieutenant Colonel (Retired) Alex Vindman is a 21-year U.S. Army combat veteran who served under presidents of both parties. He immigrated from the Soviet Union at age three as a refugee. He was wounded in Iraq and received a Purple Heart. He served as a Director on the National Security Council staff, leading hundreds in high-pressure situations. He reported misconduct during the Trump presidency, leading to the 2019 impeachment, and faced presidential retribution that ended his military career. Post-Army he focused on helping veterans run for office. He currently lives in Florida with his wife Rachel and their family.

Core launch framing: "I'm not a politician. I served 21 years in the Army and I've served presidents of both parties."$$,
 jsonb_build_object('source','source_corpus_20260515','source_type','campaign_site','url','https://www.alexvindman.com','sentiment','positive'));

-- ─── Append to knowledge_base so editor Save preserves this content ─────────────
UPDATE bots
SET knowledge_base = knowledge_base || E'\n\n--- ADDITIONAL SOURCED CORPUS (May 2026) ---\n\n' || $kb$
## Florida First Agenda (campaign platform — alexvindman.com)

**Cut Costs and Stand Up for Hardworking People** — Costs are totally out of control. Tax relief for middle-class families; make the tax system fair; close loopholes for tax cheats; transparency measures against corporate price gouging. Invest in public education, the trades, small business, and a 21st-century economy with good-paying jobs.

**Crush Corruption** — Ban insider trading by members of Congress and send violators to jail. Crack down on dark money in elections. Strengthen ethics laws with real consequences. Expand congressional oversight. Reject corporate PAC money. Repeal Citizens United.

**End the Florida Home Insurance Crisis** — Increase market competition among insurers, hold them accountable for spiking rates, address underlying risks driving premiums. Smart investments in resilience and disaster mitigation.

**Make Housing More Affordable** — Renters pay roughly 38% of monthly income on rent. Cut red tape slowing construction, support first-time homebuyers, take on corporate investors treating housing as a speculative asset.

**Ensure Affordable Healthcare and Prescription Drugs** — Defend and strengthen the ACA. Lower drug prices. Expand access. Increase addiction-services funding. Add dental and eye coverage to Medicare. Expand Medicaid and Medicare access. Oppose Big Pharma's role in the opioid crisis and overpricing of medicines.

**Invest in Strong Public Schools** — Invest in teachers, modern classrooms, career and technical education. Oppose defunding or politicizing public education.

**Steady Foreign Policy** — As a 21-year Army veteran wounded in Iraq, oppose forever wars. Defend American interests, support allies, prioritize cost-effective policy. Increase VA funding. Support veterans with job training, affordable housing, and transition programs.

## Campaign Launch — January 27, 2026 (verbatim from launch video)

"I'm Alex Vindman and I'm running for the U.S. Senate. Chaos, corruption and skyrocketing costs are crushing ordinary people, while the billionaires and career politicians profit."

"The last time you saw me was here, swearing an oath to tell the truth about a president who broke his."

"See, my family came here as refugees to escape tyranny, and I sure as hell wasn't going to bow down to some wannabe tyrant."

"This president unleashed a reign of terror and retribution, not just against me and my family, but against all of us."

"Today, our country is in chaos. Thug militias attacking citizens. Tariffs pushing prices sky-high. Health care premiums through the roof."

"They put Moody in the Senate to be a 'yes' vote for Trump and the billionaires. She's not Florida's senator. She's theirs."

"I stepped up when my country needed a soldier, I reported corruption at the highest levels of government, and now I'm stepping up again to fight for Floridians."

"I stood up when someone had to say — no one is above the law."

## Impeachment Testimony — November 19, 2019 (key verbatim passages)

"I have dedicated my entire professional life to the United States of America."

On the July 25 2019 Trump–Zelensky call: "It is improper for the President of the United States to demand a foreign government investigate a U.S. citizen and political opponent."

To his father, watching from the audience: "Dad, my sitting here today, in the U.S. Capitol talking to our elected officials, is proof that you made the right decision forty years ago to leave the Soviet Union and come here to the United States of America in search of a better life for our family. Do not worry, I will be fine for telling the truth."

On the contrast with Russia: in countries like Russia, "offering public testimony involving the President would surely cost me my life." He thanked the country for the freedom to speak the truth without fear.

## Memoir — Here, Right Matters: An American Story (Harper, August 2021)

Title comes from his father's line before the testimony: "Don't worry, Alex; right matters here." The book covers his journey from refugee child in Brooklyn, through his 21-year Army career, his deployment and wound in Iraq, his NSC work, and the choice to testify. Themes: duty, the immigrant's faith in American institutions, and the cost of doing the right thing.
$kb$,
    updated_at = now()
WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1';

COMMIT;

-- Report
SELECT
  (SELECT length(knowledge_base) FROM bots WHERE id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS knowledge_base_chars,
  (SELECT count(*) FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1' AND metadata->>'source' = 'source_corpus_20260515') AS new_corpus_chunks,
  (SELECT count(*) FROM bot_knowledge_chunks WHERE bot_id = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1') AS total_chunks;
