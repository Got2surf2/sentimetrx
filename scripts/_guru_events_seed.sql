-- 2026-05-18 — Seed temple-events chunks for the Guru bot ahead of the new
-- weekly cron (which won't run until Monday). Events sourced from
-- https://orlandohindutemple.mhsoftware.com/ — the HSCF temple's third-party
-- calendar widget. Tagged metadata.source='temple_events_cron' so the cron's
-- DELETE-and-INSERT cycle replaces these cleanly on first run.
--
-- Past events (April + first half of May) excluded — only May 17 onward.

BEGIN;

-- Clear any prior event seed
DELETE FROM bot_knowledge_chunks
WHERE bot_id = '198073e4-7d80-4437-9120-fede6539506a'
  AND metadata->>'source' = 'temple_events_cron';

INSERT INTO bot_knowledge_chunks (bot_id, title, content, metadata) VALUES

('198073e4-7d80-4437-9120-fede6539506a',
 'Temple events — Week of May 17 to May 23, 2026',
 $$Upcoming temple events at the Hindu Society of Central Florida for this week:

- **2026-05-17** — Balaji Abhishekam (W) (8:00 AM - 9:00 AM)
- **2026-05-18** — Shiva Abhishekam (W) (7:00 PM - 8:00 PM)
- **2026-05-19** — Hanuman Chalisa (W) (7:00 PM - 8:00 PM)
- **2026-05-23** — Vaikasi Visakam Celebrations (5:00 PM - 9:00 PM)

Full calendar: https://orlandohindutemple.mhsoftware.com/$$,
 jsonb_build_object('source','temple_events_cron','week_start','2026-05-17','refreshed_at','2026-05-18T00:00:00Z')),

('198073e4-7d80-4437-9120-fede6539506a',
 'Temple events — Week of May 24 to May 30, 2026',
 $$Upcoming temple events at the Hindu Society of Central Florida for this week:

- **2026-05-24** — Balaji Abhishekam (W) (8:00 AM - 9:00 AM)
- **2026-05-25** — Shiva Abhishekam (W) (7:00 PM - 8:00 PM)
- **2026-05-26** — Ekadashi
- **2026-05-26** — Hanuman Chalisa (W) (7:00 PM - 8:00 PM)
- **2026-05-28** — Pradosham
- **2026-05-28** — Shiva Abhishekam (7:00 PM - 8:00 PM)
- **2026-05-29** — Durga Ma Puja (Chowki) (M) (6:00 PM - 9:00 PM)
- **2026-05-30** — Poornima
- **2026-05-30** — Vaikasi Visakam Occurs
- **2026-05-30** — Satyanarayana Pooja (7:00 PM - 9:00 PM)

Full calendar: https://orlandohindutemple.mhsoftware.com/$$,
 jsonb_build_object('source','temple_events_cron','week_start','2026-05-24','refreshed_at','2026-05-18T00:00:00Z')),

('198073e4-7d80-4437-9120-fede6539506a',
 'Temple events — Week of May 31 to Jun 6, 2026',
 $$Upcoming temple events at the Hindu Society of Central Florida for this week:

- **2026-05-31** — Balaji Abhishekam (W) (8:00 AM - 9:00 AM)
- **2026-06-01** — Shiva Abhishekam (W) (7:00 PM - 8:00 PM)
- **2026-06-02** — Hanuman Chalisa (W) (7:00 PM - 8:00 PM)
- **2026-06-03** — Sankata Hara Chaturthi
- **2026-06-03** — Ganesh Abhishekam (6:00 PM - 7:00 PM)
- **2026-06-05** — Lalitha Sahasranama (M) (7:00 PM - 9:00 PM)
- **2026-06-06** — Venkateswara / Andal Kalyanam (M) (4:00 PM - 7:00 PM)

Full calendar: https://orlandohindutemple.mhsoftware.com/$$,
 jsonb_build_object('source','temple_events_cron','week_start','2026-05-31','refreshed_at','2026-05-18T00:00:00Z'));

COMMIT;

SELECT count(*) AS event_chunks
FROM bot_knowledge_chunks
WHERE bot_id = '198073e4-7d80-4437-9120-fede6539506a'
  AND metadata->>'source' = 'temple_events_cron';
