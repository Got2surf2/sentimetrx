-- ============================================================
-- SENTIMETRX.AI — Test Study Seed Data
-- Run AFTER 001_schema.sql and AFTER creating your admin user
-- (Step 6 in the deployment guide).
-- This inserts one test study so you can verify everything works.
-- ============================================================

-- First, insert your admin user record.
-- Replace the two placeholder values:
--   YOUR_ADMIN_AUTH_UID  → copy from Supabase Auth dashboard
--   your@email.com       → your login email
INSERT INTO users (id, client_id, email, full_name, role)
VALUES (
  'YOUR_ADMIN_AUTH_UID',    -- paste from Supabase Auth > Users tab
  (SELECT id FROM clients WHERE slug = 'sentimetrx'),
  'your@email.com',         -- your login email
  'Platform Admin',
  'platform_admin'
);

-- Insert one test study — Coalition for the Homeless
-- This matches the "Charity" bot from the prototype
INSERT INTO studies (
  guid,
  client_id,
  created_by,
  name,
  bot_name,
  bot_emoji,
  status,
  config
)
VALUES (
  'test-charity-001',
  (SELECT id FROM clients WHERE slug = 'sentimetrx'),
  (SELECT id FROM users WHERE email = 'your@email.com'),
  'Coalition for the Homeless — Donor Feedback 2026',
  'Charity',
  '🤝',
  'active',
  '{
    "greeting": "Hi there — I''m Charity 🤝 I''m helping the Coalition for the Homeless of Central Florida better understand what motivates donors and how people decide which organizations to support. Your honest perspective is exactly what we''re looking for. Just a few minutes?",
    "ratingPrompt": "To start — how familiar are you with the Coalition for the Homeless of Central Florida and the work they do?",
    "ratingScale": [
      {"emoji":"🤷","label":"Not familiar","score":1},
      {"emoji":"👀","label":"Heard of them","score":2},
      {"emoji":"📖","label":"Know a bit","score":3},
      {"emoji":"👍","label":"Know them well","score":4},
      {"emoji":"❤️","label":"Strong supporter","score":5}
    ],
    "promoterQ1": "That''s great to hear — thank you. What originally drew you to support the Coalition specifically? Was it something they did, something you saw, or someone who pointed you their way?",
    "passiveQ1":  "Thanks for sharing that. What would make you feel more compelled to actively support the Coalition — is it more about learning what they do, seeing their impact, or something else?",
    "detractorQ1":"That''s really helpful to know. What would need to change for the Coalition to feel like an organization worth supporting — is it about awareness, trust, proof of impact, or something else?",
    "q3": "When you''re deciding whether to donate to a charitable organization — any organization — what matters most to you? What makes you trust one enough to actually give?",
    "q4": "Thinking specifically about how the Coalition reaches out to donors and tells its story — what do you think they could do better to connect with people like you?",
    "clarifiers": {
      "trust":        "You mentioned trust — can you say more about what builds or breaks that for you with a charity? Is it transparency, third-party ratings, personal stories, or something else?",
      "impact":       "On impact — what would actually make you feel confident your donation did something real? Numbers, stories, a specific program, or seeing it firsthand?",
      "transparency": "You mentioned transparency — what does that look like in practice to you?",
      "story":        "On storytelling — is it more that you want to hear from the people they''ve helped, or understand the bigger picture?",
      "local":        "You mentioned the local angle — why does giving locally feel different from giving to a national organisation?",
      "default":      "Can you say a bit more about what''s driving that? Understanding how donors think is exactly what the Coalition is trying to learn."
    },
    "psychographicBank": [
      {"key":"donor_status",     "q":"Which best describes your current relationship with the Coalition?","opts":["Current regular donor","Past donor — lapsed","Considering giving for the first time","I support in other ways","No prior connection"]},
      {"key":"giving_decision",  "q":"When you decide to give to a charity for the first time, what usually tips you over the line?","opts":["A personal story that moved me","Concrete proof it works","A recommendation from someone I trust","An event or campaign that caught my attention","I research it thoroughly first"]},
      {"key":"giving_frequency", "q":"How would you describe your overall approach to charitable giving?","opts":["I give regularly to a small number of causes","I give when something moves me","I give to many causes throughout the year","I give mainly through workplace matching","It''s occasional"]},
      {"key":"trust_signal",     "q":"What most builds your trust in a charitable organisation?","opts":["Independent ratings — Charity Navigator etc.","Personal stories from people helped","Financial transparency","Endorsements from community leaders","My own direct experience"]},
      {"key":"lapse_reason",     "q":"What most causes someone to stop donating to an organisation they once supported?","opts":["Feeling donations aren''t making a difference","Too many asks — feeling pressured","The organisation lost focus","Personal finances changed","Found a cause they connected with more"]},
      {"key":"comms_preference", "q":"How do you prefer a charity to keep you informed after you''ve given?","opts":["Email updates with impact stories","Social media content","An annual report","Invitations to events","Just a thank you — I don''t need much"]}
    ],
    "theme": {
      "primaryColor":      "#1a7a4a",
      "headerGradient":    "linear-gradient(135deg, #1a7a4a, #0d4a2a)",
      "backgroundColor":   "#0a1628",
      "accentColor":       "#4ade80",
      "botAvatarGradient": "linear-gradient(135deg, #1a7a4a, #0d4a2a)"
    }
  }'
);

-- Confirm everything looks right
SELECT
  s.guid,
  s.name,
  s.bot_name,
  s.status,
  c.name AS client_name
FROM studies s
JOIN clients c ON c.id = s.client_id;
