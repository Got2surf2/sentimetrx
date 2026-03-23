// lib/industryDefaults.ts
// Default study config values per industry
//
// INDUSTRY ↔ ANA LIBRARY MAPPING
// Every key here has an exact 1:1 match to an Ana theme library name.
// This is the contract used by the survey-to-dataset bridge to auto-select
// the correct Ana theme library when creating a linked dataset.
// Kept in sync with Ana's INDUSTRY_THEMES keys — do not rename without
// updating both sides.

import type { StudyConfig, PsychoQuestion } from './types'

export type Industry =
  | 'healthcare'
  | 'hospitality'
  | 'casual_dining'
  | 'fine_dining'
  | 'fast_food'
  | 'travel_tourism'
  | 'political'
  | 'media_entertainment'
  | 'performing_arts'
  | 'saas_software'
  | 'retail_ecommerce'
  | 'financial_services'
  | 'education'
  | 'higher_education'
  | 'hr_employee'
  | 'sports'
  | 'nonprofit'
  | 'automotive_repair'
  | 'other'

// Human-readable labels shown in the study creator dropdown
export const INDUSTRY_LABELS: Record<Industry, string> = {
  healthcare:          'Healthcare',
  hospitality:         'Hospitality (Hotel / Lodging)',
  casual_dining:       'Restaurants — Casual Dining',
  fine_dining:         'Restaurants — Fine Dining',
  fast_food:           'Restaurants — Fast Food / Quick Service',
  travel_tourism:      'Travel & Tourism',
  political:           'Politics & Advocacy',
  media_entertainment: 'Entertainment — Media & Film',
  performing_arts:     'Entertainment — Performing Arts & Venues',
  saas_software:       'SaaS / Software',
  retail_ecommerce:    'Retail / E-commerce',
  financial_services:  'Financial Services',
  education:           'Education (K-12)',
  higher_education:    'Higher Education',
  hr_employee:         'HR / Employee Experience',
  sports:              'Sports',
  nonprofit:           'Non-Profit / Charity',
  automotive_repair:   'Automotive Repair',
  other:               'Other / Custom',
}

// Maps every Sentimetrx industry key to the exact Ana theme library name.
// Used by the survey bridge: dataset.ana_library = ANA_LIBRARY_KEY[study.config.industry]
export const ANA_LIBRARY_KEY: Record<Exclude<Industry, 'other'>, string> = {
  healthcare:          'Healthcare',
  hospitality:         'Hospitality / Hotels',
  casual_dining:       'Casual Dining',
  fine_dining:         'Fine Dining',
  fast_food:           'Fast Food',
  travel_tourism:      'Travel / Tourism',
  political:           'Political Opinion Survey',
  media_entertainment: 'Media / Entertainment',
  performing_arts:     'Performing Arts / Venues',
  saas_software:       'SaaS / Software',
  retail_ecommerce:    'Retail / E-commerce',
  financial_services:  'Financial Services',
  education:           'Education',
  higher_education:    'Higher Education',
  hr_employee:         'HR / Employee Experience',
  sports:              'Sports',
  nonprofit:           'Non-Profit / Charity',
  automotive_repair:   'Automotive Repair',
}

type Defaults = Pick<StudyConfig,
  | 'greeting'
  | 'ratingPrompt'
  | 'promoterQ1'
  | 'passiveQ1'
  | 'detractorQ1'
  | 'q3'
  | 'q4'
  | 'clarifiers'
  | 'psychographicBank'
>

export const INDUSTRY_DEFAULTS: Record<Exclude<Industry, 'other'>, Defaults> = {

  // ── HEALTHCARE ──────────────────────────────────────────────────────────────
  healthcare: {
    greeting: "Hi — I'm here to gather your feedback about your recent care experience. It'll only take a few minutes, and your input genuinely helps us improve.",
    ratingPrompt: "How would you rate your overall care experience today?",
    promoterQ1: "That's wonderful to hear! What stood out most about the care you received?",
    passiveQ1: "Thank you for sharing that. What could we have done to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. Which aspect of your care experience fell short of your expectations?",
    q3: "Were there any specific moments — with staff, the facility, or the process — that you'd like to highlight?",
    q4: "Is there anything else about your visit today you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      wait: "How long did you have to wait, and how did that affect your experience?",
      staff: "Which member of staff are you referring to, and what happened?",
      communication: "What information do you feel was missing or unclear?",
    },
    psychographicBank: [
      { key: 'hc_health_approach', q: "How would you describe your overall approach to your health?", exportLabel: "Health Approach",
        opts: ["Proactive — I stay on top of it", "Reactive — I deal with issues as they arise", "Cautious — I prefer conservative options", "Pragmatic — whatever works"] },
      { key: 'hc_provider_trust', q: "How much do you trust healthcare providers to act in your best interest?", exportLabel: "Provider Trust",
        opts: ["Very high — I follow advice without question", "High — but I like to understand the reasoning", "Moderate — I often seek a second opinion", "Low — I prefer to research everything myself"] },
      { key: 'hc_info_seeking', q: "When you have a health concern, what do you typically do first?", exportLabel: "Health Info Seeking",
        opts: ["Call my doctor or clinic", "Search online", "Ask friends or family", "Wait and see if it resolves", "Use a health app"] },
      { key: 'hc_continuity', q: "How important is it to see the same provider consistently?", exportLabel: "Care Continuity Value",
        opts: ["Extremely important", "Quite important", "Somewhat important", "Not very important"] },
    ],
  },

  // ── HOSPITALITY ─────────────────────────────────────────────────────────────
  hospitality: {
    greeting: "Welcome! I'd love to hear about your stay with us. Your feedback helps us make every guest experience exceptional.",
    ratingPrompt: "How would you rate your overall stay with us?",
    promoterQ1: "That's great to hear! What made your stay particularly enjoyable?",
    passiveQ1: "Thank you for that. What could we have done to make your stay even better?",
    detractorQ1: "I'm sorry your stay didn't meet expectations. What was the main issue?",
    q3: "Were there any specific moments — with the room, service, facilities, or team — you'd like to tell us about?",
    q4: "Is there anything else you'd like to share that would help us improve?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      room: "Was this about the room itself, cleanliness, amenities, or something else?",
      staff: "Which area of service are you referring to — front desk, housekeeping, dining, or another?",
      facilities: "Which facility are you referring to — the pool, gym, restaurant, or another?",
    },
    psychographicBank: [
      { key: 'ho_travel_style', q: "How would you describe your typical travel style?", exportLabel: "Travel Style",
        opts: ["Luxury seeker — I prioritise quality and comfort", "Value-conscious — I want good quality at a fair price", "Experience-driven — unique experiences matter most", "Practical — I just need clean and convenient"] },
      { key: 'ho_loyalty', q: "How do loyalty programmes influence your hotel choices?", exportLabel: "Loyalty Programme Attitude",
        opts: ["Major factor — I always choose based on my programme", "Moderate factor — I'll pick loyalty hotels when comparable", "Minor factor — I consider it but it rarely decides", "Not a factor — I don't use loyalty programmes"] },
      { key: 'ho_service_expectation', q: "What matters most to you when it comes to hotel service?", exportLabel: "Service Priority",
        opts: ["Personalised and attentive", "Efficient and unobtrusive", "Friendly and approachable", "Consistent and reliable"] },
      { key: 'ho_booking_mindset', q: "How do you typically feel about paying extra for hotel upgrades?", exportLabel: "Upgrade Attitude",
        opts: ["Happy to pay for a noticeably better experience", "Only if the value is very clear", "I rarely upgrade", "I prefer to keep costs predictable"] },
    ],
  },

  // ── CASUAL DINING ───────────────────────────────────────────────────────────
  casual_dining: {
    greeting: "Hi! I'm here to get your thoughts on your dining experience today. It only takes a few minutes and really helps us do better.",
    ratingPrompt: "How would you rate your overall dining experience today?",
    promoterQ1: "That's fantastic! What made your experience stand out today?",
    passiveQ1: "Thanks for that. What one thing could we have done to make it a better visit?",
    detractorQ1: "I'm sorry to hear that. What was the main thing that let you down today?",
    q3: "Were there any specific moments — with the food, service, or atmosphere — you'd like to tell us about?",
    q4: "Is there anything else you'd like us to know about your visit today?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      food: "Was this about the taste, portion size, temperature, presentation, or something else?",
      service: "Which part of the service experience are you referring to?",
      wait: "Was the wait at the door, for a table, for food to arrive, or for the bill?",
    },
    psychographicBank: [
      { key: 'cd_dining_motivation', q: "What typically motivates you to dine out rather than eat at home?", exportLabel: "Dining Motivation",
        opts: ["Convenience and saving time", "Enjoying a social occasion", "Trying new food or cuisine", "A treat or reward", "Habit — it's part of my routine"] },
      { key: 'cd_food_values', q: "Which of these matters most to you when choosing a casual restaurant?", exportLabel: "Restaurant Choice Driver",
        opts: ["Consistent quality I can rely on", "Good value for money", "A menu with variety", "Atmosphere and ambience", "Speed of service"] },
      { key: 'cd_frequency_attitude', q: "How do you think about dining out in terms of your weekly routine?", exportLabel: "Dining Frequency Attitude",
        opts: ["It's a regular treat I look forward to", "It's part of my weekly routine", "I do it mainly for convenience", "It's occasional — usually for a reason"] },
      { key: 'cd_health_conscious', q: "How much do health and nutritional considerations influence your menu choices?", exportLabel: "Health Consciousness",
        opts: ["Very much — I always look for healthier options", "Quite a bit — I try to balance enjoyment and health", "A little — I notice but don't let it decide", "Not at all — I order what I enjoy"] },
    ],
  },

  // ── FINE DINING ─────────────────────────────────────────────────────────────
  fine_dining: {
    greeting: "Good evening. On behalf of the team, thank you for joining us tonight. I'd love to hear about your experience — your feedback means a great deal to us.",
    ratingPrompt: "How would you rate your overall dining experience with us this evening?",
    promoterQ1: "I'm truly glad to hear that. What was the highlight of your evening with us?",
    passiveQ1: "Thank you for your candour. What could we have done to make your evening exceptional?",
    detractorQ1: "I sincerely apologise that we fell short. What aspect of the experience disappointed you most?",
    q3: "Were there any specific moments — with the cuisine, the service, or the atmosphere — you'd like to share?",
    q4: "Is there anything further you'd like to tell us that would help us maintain our standards?",
    clarifiers: {
      default: "Could you elaborate a little on that?",
      food: "Are you referring to the flavours, presentation, temperature, pacing of courses, or something else?",
      service: "Which aspect of the service experience stood out — the welcome, table service, sommelier, or another area?",
      atmosphere: "What about the ambience — the setting, noise level, music, or another element?",
    },
    psychographicBank: [
      { key: 'fd_dining_philosophy', q: "How would you describe your relationship with fine dining?", exportLabel: "Fine Dining Philosophy",
        opts: ["A genuine passion — I seek out exceptional culinary experiences", "A special treat for significant occasions", "An important part of my professional and social life", "Something I appreciate but don't pursue actively"] },
      { key: 'fd_cuisine_priority', q: "When evaluating a fine dining experience, what matters most to you?", exportLabel: "Experience Priority",
        opts: ["The cuisine and culinary creativity", "The overall service and attention to detail", "The atmosphere and setting", "The wine and beverage programme", "The full experience as a whole"] },
      { key: 'fd_discovery', q: "How do you typically discover new fine dining restaurants?", exportLabel: "Discovery Method",
        opts: ["Critical reviews and food publications", "Personal recommendations from trusted sources", "Awards and recognition (Michelin, etc.)", "Social media and food content", "A chef's reputation"] },
      { key: 'fd_value_mindset', q: "How do you think about value in fine dining?", exportLabel: "Value Mindset",
        opts: ["I focus on the quality of the experience, not the price", "I expect the price to be fully justified by the quality", "I set a budget and choose within it", "Value is secondary — it's about the occasion"] },
    ],
  },

  // ── FAST FOOD ───────────────────────────────────────────────────────────────
  fast_food: {
    greeting: "Hi! We'd love a moment of your feedback about your visit today. It's quick, we promise!",
    ratingPrompt: "How would you rate your overall experience with us today?",
    promoterQ1: "Great to hear! What did we get right today?",
    passiveQ1: "Thanks for that! What's the one thing we could do to make your next visit even better?",
    detractorQ1: "Sorry to hear that. What went wrong today?",
    q3: "Were there any issues — with your order, the service, wait times, or anything else?",
    q4: "Anything else you'd like to tell us?",
    clarifiers: {
      default: "Can you tell me a bit more about that?",
      order: "Was there a problem with what you ordered — accuracy, quality, temperature, or something else?",
      wait: "Was the wait too long at the counter, drive-through, or for your food to be prepared?",
      cleanliness: "Was this about the dining area, tables, restrooms, or another part of the restaurant?",
    },
    psychographicBank: [
      { key: 'ff_visit_driver', q: "What mainly drives you to choose quick service restaurants?", exportLabel: "Visit Driver",
        opts: ["Speed and convenience above all", "Consistent food I know I'll enjoy", "Value for money", "Habit — it's just what I do", "Specific menu items I like"] },
      { key: 'ff_quality_expectation', q: "What does 'good quality' mean to you at a fast food restaurant?", exportLabel: "Quality Expectation",
        opts: ["Hot, fresh food every time", "My order is always correct", "Clean environment", "Good ingredients for the price", "Fast service without errors"] },
      { key: 'ff_loyalty_behaviour', q: "How loyal are you to particular quick service brands?", exportLabel: "Brand Loyalty",
        opts: ["Very loyal — I almost always use the same brands", "Somewhat loyal — I have a few favourites", "Flexible — I go with whatever is convenient", "Variety-seeker — I like to mix it up"] },
      { key: 'ff_mobile_usage', q: "How do you typically interact with fast food brands outside the restaurant?", exportLabel: "Digital Engagement",
        opts: ["I use their app regularly for ordering and offers", "I occasionally check their app for deals", "I order through third-party delivery apps", "I don't use apps — I order in person"] },
    ],
  },

  // ── TRAVEL & TOURISM ────────────────────────────────────────────────────────
  travel_tourism: {
    greeting: "Hi! I'd love to hear about your travel experience with us. A few minutes of your feedback goes a long way.",
    ratingPrompt: "How would you rate your overall travel experience with us?",
    promoterQ1: "That's wonderful! What made this experience so memorable?",
    passiveQ1: "Thank you for sharing that. What could we have done to make the trip exceptional?",
    detractorQ1: "I'm sorry the experience fell short. What was the main issue during your trip?",
    q3: "Were there any specific moments — with booking, the journey itself, accommodation, or service — you'd like to highlight?",
    q4: "Is there anything else about your travel experience you'd like to share?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      booking: "Was this about the booking process, communication, or something that changed from what you expected?",
      service: "Which part of the service experience are you referring to?",
      logistics: "Was this about timing, transport connections, or something else logistical?",
    },
    psychographicBank: [
      { key: 'tr_travel_identity', q: "How would you describe yourself as a traveller?", exportLabel: "Traveller Identity",
        opts: ["Adventure seeker — I love new challenges and off-the-beaten-path experiences", "Culture enthusiast — history, food, and local life are my focus", "Relaxation-focused — I travel to recharge and unwind", "Convenience traveller — I value easy, well-organised trips"] },
      { key: 'tr_planning_style', q: "How do you prefer to approach travel planning?", exportLabel: "Planning Style",
        opts: ["Fully planned — I research and book everything in advance", "Mostly planned — key things booked, room for spontaneity", "Loosely planned — I prefer to figure it out as I go", "Fully spontaneous — I rarely plan ahead"] },
      { key: 'tr_experience_priority', q: "What do you value most when travelling?", exportLabel: "Experience Priority",
        opts: ["Authentic local experiences", "Comfort and quality accommodation", "Good value for the overall cost", "Seeing the must-see sights", "Complete relaxation and downtime"] },
      { key: 'tr_sustainability', q: "How much does sustainability influence your travel choices?", exportLabel: "Sustainability Attitude",
        opts: ["Significantly — I actively seek sustainable options", "Moderately — I consider it when options are comparable", "Slightly — I'm aware but it rarely changes my decision", "Not yet — I don't currently factor it in"] },
    ],
  },

  // ── POLITICS & ADVOCACY ─────────────────────────────────────────────────────
  political: {
    greeting: "Hi — thank you for taking part. I'm here to hear your views and experiences. Your voice matters and this will only take a few minutes.",
    ratingPrompt: "How would you rate your overall experience with our campaign or event today?",
    promoterQ1: "That's great to hear! What resonated most with you today?",
    passiveQ1: "Thank you for your time. What could we have done better to connect with you today?",
    detractorQ1: "I'm sorry to hear that. What fell short of your expectations today?",
    q3: "Are there specific issues or topics you feel aren't being addressed that are important to you?",
    q4: "Is there anything else you'd like our team to know?",
    clarifiers: {
      default: "Could you tell me a bit more about what you mean?",
      policy: "Which specific policy area are you referring to?",
      event: "Was there a particular moment or speaker you're referring to?",
      communication: "How would you prefer to receive information from us in the future?",
    },
    psychographicBank: [
      { key: 'po_political_engagement', q: "How would you describe your level of political engagement?", exportLabel: "Political Engagement",
        opts: ["Highly engaged — I follow politics closely and take action", "Engaged — I stay informed and vote", "Occasionally engaged — I pay attention to major issues", "Low engagement — I find politics overwhelming or remote"] },
      { key: 'po_trust_institutions', q: "How much do you trust political institutions to represent your interests?", exportLabel: "Institutional Trust",
        opts: ["High trust — the system works reasonably well", "Moderate trust — it works, but needs improvement", "Low trust — significant reform is needed", "Very low trust — I've largely lost faith"] },
      { key: 'po_change_mindset', q: "How do you see the role of political change?", exportLabel: "Change Mindset",
        opts: ["Incremental change — steady progress within the system", "Significant reform — major changes are overdue", "Transformation — the system itself needs rethinking", "Stability — maintaining what works is the priority"] },
      { key: 'po_community_identity', q: "Which best describes your primary political identity?", exportLabel: "Community Identity",
        opts: ["Local community member first", "Regional / state identity first", "National identity first", "I don't identify strongly with any geographic community"] },
    ],
  },

  // ── MEDIA & ENTERTAINMENT ───────────────────────────────────────────────────
  media_entertainment: {
    greeting: "Hi! We'd love to hear your thoughts on your experience with us today. It only takes a moment and genuinely helps us improve.",
    ratingPrompt: "How would you rate your overall experience today?",
    promoterQ1: "Brilliant! What did you enjoy most about it?",
    passiveQ1: "Thank you for that. What one change would have made it a better experience?",
    detractorQ1: "I'm sorry it didn't hit the mark. What was the main thing that let you down?",
    q3: "Were there any specific aspects — the content, platform, recommendations, or service — you'd like to comment on?",
    q4: "Is there anything else about your experience you'd like to share?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      content: "Are you referring to the quality, variety, or availability of the content itself?",
      platform: "Was this about the app, website, streaming quality, or ease of use?",
      discovery: "Was it hard to find what you were looking for, or something you expected to find wasn't there?",
    },
    psychographicBank: [
      { key: 'me_content_relationship', q: "How would you describe your relationship with media and entertainment content?", exportLabel: "Content Relationship",
        opts: ["Passionate — content is central to my leisure time", "Regular consumer — it's a big part of my daily routine", "Casual — I dip in when I have time", "Selective — I seek out specific content I care deeply about"] },
      { key: 'me_platform_loyalty', q: "How do you feel about subscription streaming services?", exportLabel: "Platform Loyalty",
        opts: ["Loyal — I stick with a small number of services long-term", "Value-driven — I subscribe and cancel based on content", "Selective — I choose based on a specific show or film", "Reluctant — I'd rather buy or rent than subscribe"] },
      { key: 'me_discovery_behaviour', q: "How do you typically discover new content to watch or engage with?", exportLabel: "Discovery Behavior",
        opts: ["Algorithm and platform recommendations", "Friends and social media", "Reviews and critics", "Trailers and marketing", "Browsing until something catches my eye"] },
      { key: 'me_social_viewing', q: "How social is your media consumption?", exportLabel: "Viewing Sociality",
        opts: ["Highly social — I watch with others and discuss content a lot", "Mixed — I enjoy both solo and social viewing", "Mostly solo — I prefer watching on my own terms", "Entirely solo — media time is personal time"] },
    ],
  },

  // ── PERFORMING ARTS & VENUES ────────────────────────────────────────────────
  performing_arts: {
    greeting: "Hi — thank you for joining us! I'd love to hear about your experience today. Your feedback helps us make every visit special.",
    ratingPrompt: "How would you rate your overall experience at today's event?",
    promoterQ1: "Wonderful! What was the highlight of the experience for you?",
    passiveQ1: "Glad you came. What could we have done to make it truly memorable?",
    detractorQ1: "I'm sorry it didn't live up to expectations. What let you down?",
    q3: "Were there any specific aspects — the performance, the venue, the atmosphere, or the logistics — you'd like to comment on?",
    q4: "Is there anything else you'd like to tell us about your visit today?",
    clarifiers: {
      default: "Could you tell me a little more about that?",
      performance: "Which part of the performance or programme are you referring to?",
      venue: "Was this about the physical space, seating, acoustics, sightlines, or facilities?",
      logistics: "Was this about entry, queuing, parking, ticketing, or getting to your seat?",
    },
    psychographicBank: [
      { key: 'pa_arts_engagement', q: "How would you describe your relationship with the performing arts?", exportLabel: "Arts Engagement",
        opts: ["Deeply passionate — it's a central part of my life", "Regular attendee — I go often and love it", "Occasional visitor — a few times a year for special events", "Newcomer or rare visitor — this is an unusual occasion for me"] },
      { key: 'pa_experience_priority', q: "What matters most to you when attending a live performance?", exportLabel: "Experience Priority",
        opts: ["The quality of the performance itself", "The atmosphere and energy of being there live", "The venue and overall environment", "Sharing the experience with others", "All of these in balance"] },
      { key: 'pa_discovery', q: "How do you typically find out about events you want to attend?", exportLabel: "Event Discovery",
        opts: ["Following specific performers, companies, or venues", "Recommendations from friends or family", "Reviews and arts media", "Email newsletters and memberships", "Social media and online advertising"] },
      { key: 'pa_support_mindset', q: "How do you think about your attendance in terms of supporting the arts?", exportLabel: "Support Mindset",
        opts: ["Very important — supporting the arts sector is a value I hold", "Important — I like knowing my attendance helps", "Moderate — it's a factor but not my main reason for coming", "Not my main lens — I come purely for my own enjoyment"] },
    ],
  },

  // ── SAAS / SOFTWARE ────────────────────────────────────────────────────────
  saas_software: {
    greeting: "Hi! We'd love your feedback on your experience with our product. It only takes a few minutes and helps us build a better tool for you.",
    ratingPrompt: "How would you rate your overall experience with our software?",
    promoterQ1: "That's great to hear! What do you value most about the product?",
    passiveQ1: "Thank you for sharing. What's the main thing we could improve?",
    detractorQ1: "Sorry to hear that. What's the biggest issue you're facing?",
    q3: "Are there specific features, workflows, or areas of the product you'd like to comment on?",
    q4: "Is there anything else you'd like our product team to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      feature: "Which specific feature or workflow are you referring to?",
      performance: "Is this about speed, reliability, errors, or something else?",
      support: "What was your experience with our support team?",
    },
    psychographicBank: [
      { key: 'sw_role', q: "What best describes your role when using this product?", exportLabel: "User Role",
        opts: ["Decision-maker — I chose and manage the tool", "Power user — I use it daily and deeply", "Casual user — I use it occasionally", "Administrator — I manage it for others"] },
      { key: 'sw_tech_comfort', q: "How comfortable are you with learning new software tools?", exportLabel: "Tech Comfort",
        opts: ["Very comfortable — I pick things up quickly", "Fairly comfortable — I need a bit of guidance", "Moderate — I prefer simple interfaces", "Not very comfortable — I need a lot of hand-holding"] },
      { key: 'sw_eval_factor', q: "What matters most when evaluating software?", exportLabel: "Evaluation Factor",
        opts: ["Ease of use", "Feature depth", "Price / value", "Integration with existing tools", "Customer support quality"] },
      { key: 'sw_switch_risk', q: "How likely are you to consider switching to an alternative product?", exportLabel: "Switch Risk",
        opts: ["Very unlikely — deeply invested", "Unlikely — satisfied for now", "Possible — if something better comes along", "Actively evaluating alternatives"] },
    ],
  },

  // ── RETAIL / E-COMMERCE ────────────────────────────────────────────────────
  retail_ecommerce: {
    greeting: "Hi! We'd love to hear about your recent shopping experience with us. Your feedback helps us serve you better.",
    ratingPrompt: "How would you rate your overall shopping experience?",
    promoterQ1: "Wonderful! What made your shopping experience great?",
    passiveQ1: "Thanks for sharing. What could we have done better?",
    detractorQ1: "Sorry about that. What was the main issue with your experience?",
    q3: "Were there any specific aspects — the website, products, delivery, or service — you'd like to comment on?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      delivery: "Was this about delivery speed, packaging, tracking, or something else?",
      product: "Was this about the product quality, description accuracy, or sizing?",
      returns: "Was there an issue with the returns or exchange process?",
    },
    psychographicBank: [
      { key: 're_shop_style', q: "How would you describe your shopping style?", exportLabel: "Shopping Style",
        opts: ["Researcher — I compare options carefully before buying", "Impulse buyer — I buy what catches my eye", "Loyal — I stick with brands I trust", "Deal hunter — price and discounts drive my decisions"] },
      { key: 're_channel', q: "How do you prefer to shop?", exportLabel: "Channel Preference",
        opts: ["Mostly online", "Mostly in-store", "A mix of both", "Wherever offers the best deal"] },
      { key: 're_brand_loyalty', q: "How loyal are you to specific brands?", exportLabel: "Brand Loyalty",
        opts: ["Very loyal — I repeatedly buy the same brands", "Somewhat loyal — I have preferences but explore", "Not very loyal — I go with whatever meets my needs", "I actively seek variety"] },
      { key: 're_returns', q: "How important is a flexible return policy in your purchase decisions?", exportLabel: "Return Policy Importance",
        opts: ["Essential — I won't buy without it", "Very important", "Somewhat important", "Not a major factor"] },
    ],
  },

  // ── FINANCIAL SERVICES ─────────────────────────────────────────────────────
  financial_services: {
    greeting: "Hello! We'd appreciate a few minutes of your time to share feedback on your experience with our services.",
    ratingPrompt: "How would you rate your overall experience with our financial services?",
    promoterQ1: "Great to hear! What do you value most about our services?",
    passiveQ1: "Thank you. What could we improve to better meet your needs?",
    detractorQ1: "I'm sorry to hear that. What was the main issue?",
    q3: "Were there any specific interactions — with our team, products, online banking, or processes — you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      fees: "Which specific fee or charge are you referring to?",
      service: "Was this about in-branch service, phone support, or online banking?",
      process: "Was this about a specific process — account opening, loan application, or something else?",
    },
    psychographicBank: [
      { key: 'fs_relationship', q: "How would you describe your relationship with financial institutions?", exportLabel: "Financial Relationship",
        opts: ["Highly engaged — I actively manage my finances", "Moderate — I check in periodically", "Passive — I set it and forget it", "Frustrated — I find financial services confusing"] },
      { key: 'fs_digital', q: "How do you prefer to manage your finances?", exportLabel: "Digital Preference",
        opts: ["All digital — app and online only", "Mostly digital with occasional branch visits", "Equal mix of digital and in-person", "Prefer in-person for most things"] },
      { key: 'fs_trust', q: "How much do you trust your financial institution?", exportLabel: "Trust Level",
        opts: ["Very high — they have my best interests at heart", "High — generally reliable", "Moderate — some concerns", "Low — I stay because switching is hard"] },
      { key: 'fs_priority', q: "What matters most to you in a financial service provider?", exportLabel: "Service Priority",
        opts: ["Low fees and good rates", "Excellent customer service", "Easy-to-use digital tools", "A wide range of products", "Trustworthiness and transparency"] },
    ],
  },

  // ── EDUCATION (K-12) ───────────────────────────────────────────────────────
  education: {
    greeting: "Hi! We'd love to hear your thoughts on the educational experience. Your feedback helps us improve for students and families.",
    ratingPrompt: "How would you rate the overall educational experience?",
    promoterQ1: "That's wonderful! What stands out most about the experience?",
    passiveQ1: "Thank you for sharing. What could be improved?",
    detractorQ1: "I'm sorry to hear that. What's the main concern?",
    q3: "Are there specific aspects — teaching quality, communication, facilities, or programs — you'd like to comment on?",
    q4: "Is there anything else you'd like the school to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      teaching: "Which subject, teacher, or aspect of instruction are you referring to?",
      communication: "Is this about teacher-parent communication, school updates, or something else?",
      safety: "What specifically concerns you about safety or wellbeing?",
    },
    psychographicBank: [
      { key: 'ed_involvement', q: "How involved are you in your child's education?", exportLabel: "Parent Involvement",
        opts: ["Very involved — I participate actively", "Involved — I stay informed and attend events", "Moderately involved — I check in when needed", "Minimally involved — I trust the school"] },
      { key: 'ed_priority', q: "What matters most to you in a school?", exportLabel: "Education Priority",
        opts: ["Academic excellence", "Social and emotional development", "Safety and wellbeing", "Extracurricular opportunities", "Community and values"] },
      { key: 'ed_communication', q: "How satisfied are you with school communication?", exportLabel: "Communication Satisfaction",
        opts: ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very dissatisfied"] },
    ],
  },

  // ── HIGHER EDUCATION ───────────────────────────────────────────────────────
  higher_education: {
    greeting: "Hi! We'd value your feedback on your experience with us. Your perspective helps shape the future of our institution.",
    ratingPrompt: "How would you rate your overall experience with our institution?",
    promoterQ1: "That's great to hear! What makes the experience stand out?",
    passiveQ1: "Thank you. What would make your experience better?",
    detractorQ1: "I'm sorry about that. What's the biggest issue?",
    q3: "Are there specific aspects — academics, campus life, support services, or facilities — you'd like to comment on?",
    q4: "Is there anything else you'd like the institution to know?",
    clarifiers: {
      default: "Could you tell me more about that?",
      academics: "Which program, course, or faculty are you referring to?",
      support: "Is this about advising, career services, mental health, or another support area?",
      campus: "Which facility or campus area are you referring to?",
    },
    psychographicBank: [
      { key: 'he_motivation', q: "What is your primary motivation for pursuing higher education?", exportLabel: "Education Motivation",
        opts: ["Career advancement", "Personal growth and learning", "Required for my field", "Social and networking opportunities", "Family expectations"] },
      { key: 'he_learning', q: "How do you prefer to learn?", exportLabel: "Learning Preference",
        opts: ["In-person lectures and discussions", "Online or hybrid formats", "Hands-on / experiential learning", "Self-paced with resources", "Small group collaboration"] },
      { key: 'he_balance', q: "How well do you balance academics with other responsibilities?", exportLabel: "Life Balance",
        opts: ["Very well — I have a good system", "Fairly well — some stress but manageable", "Struggling — it's hard to keep up", "Not well — I'm overwhelmed"] },
    ],
  },

  // ── HR / EMPLOYEE EXPERIENCE ───────────────────────────────────────────────
  hr_employee: {
    greeting: "Hi! We'd like to hear about your experience as an employee. Your honest feedback helps us build a better workplace.",
    ratingPrompt: "How would you rate your overall employee experience?",
    promoterQ1: "That's great! What do you value most about working here?",
    passiveQ1: "Thanks for sharing. What one thing would improve your experience?",
    detractorQ1: "I'm sorry to hear that. What's the biggest challenge you face?",
    q3: "Are there specific aspects — management, culture, growth opportunities, or benefits — you'd like to comment on?",
    q4: "Is there anything else you'd like leadership to know?",
    clarifiers: {
      default: "Could you tell me more about that?",
      management: "Is this about your direct manager, senior leadership, or management style in general?",
      culture: "What specifically about the culture are you referring to?",
      growth: "Is this about training, promotions, career development, or something else?",
    },
    psychographicBank: [
      { key: 'hr_engagement', q: "How engaged do you feel at work?", exportLabel: "Engagement Level",
        opts: ["Highly engaged — I love what I do", "Engaged — I'm satisfied and productive", "Neutral — it's a job", "Disengaged — I'm going through the motions", "Actively disengaged — I'm looking to leave"] },
      { key: 'hr_values', q: "What matters most to you in a workplace?", exportLabel: "Workplace Values",
        opts: ["Good compensation and benefits", "Work-life balance", "Growth and learning opportunities", "Positive culture and relationships", "Meaningful work and purpose"] },
      { key: 'hr_feedback', q: "How comfortable are you giving honest feedback at work?", exportLabel: "Feedback Comfort",
        opts: ["Very comfortable — it's encouraged here", "Comfortable — but I'm selective", "Somewhat comfortable — depends on the topic", "Not comfortable — I worry about consequences"] },
    ],
  },

  // ── SPORTS ─────────────────────────────────────────────────────────────────
  sports: {
    greeting: "Hey! We'd love to hear about your experience at today's event. Your feedback helps us make game days even better.",
    ratingPrompt: "How would you rate your overall experience at today's event?",
    promoterQ1: "Awesome! What made today's experience great?",
    passiveQ1: "Thanks for coming! What could we do to make it better next time?",
    detractorQ1: "Sorry to hear that. What was the main issue today?",
    q3: "Were there any specific aspects — the game, venue, food, atmosphere, or logistics — you'd like to comment on?",
    q4: "Anything else you'd like to share about your experience?",
    clarifiers: {
      default: "Could you tell me more about that?",
      venue: "Was this about seating, facilities, cleanliness, or accessibility?",
      food: "Was this about the food quality, variety, pricing, or service speed?",
      logistics: "Was this about parking, entry, exit, or getting to your seats?",
    },
    psychographicBank: [
      { key: 'sp_fandom', q: "How would you describe your level of fandom?", exportLabel: "Fan Level",
        opts: ["Die-hard — I never miss a game", "Regular — I attend frequently", "Casual — I go occasionally", "Social — I come for the atmosphere, not the sport"] },
      { key: 'sp_motivation', q: "What's the main reason you attend live events?", exportLabel: "Attendance Motivation",
        opts: ["Love the sport and the team", "Social experience with friends/family", "The atmosphere and excitement", "Corporate or client entertainment", "Taking kids to the game"] },
      { key: 'sp_spend', q: "How do you typically approach spending at the venue?", exportLabel: "Spending Attitude",
        opts: ["Big spender — food, drinks, merchandise", "Moderate — some food and drinks", "Conservative — I keep costs low", "Pre-game only — I eat and drink before arriving"] },
    ],
  },

  // ── NON-PROFIT / CHARITY ───────────────────────────────────────────────────
  nonprofit: {
    greeting: "Hi! Thank you for your involvement with us. We'd love to hear your feedback — it helps us serve our mission more effectively.",
    ratingPrompt: "How would you rate your overall experience with our organization?",
    promoterQ1: "That's wonderful! What resonates most with you about our work?",
    passiveQ1: "Thank you for sharing. How could we better engage you?",
    detractorQ1: "I'm sorry to hear that. What could we do better?",
    q3: "Are there specific aspects — our programs, communication, events, or impact — you'd like to comment on?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me more about that?",
      impact: "What specifically about our impact are you referring to?",
      communication: "Is this about how often we communicate, the content, or the channels we use?",
      events: "Which event or program are you referring to?",
    },
    psychographicBank: [
      { key: 'np_involvement', q: "How are you involved with our organization?", exportLabel: "Involvement Type",
        opts: ["Regular donor", "Volunteer", "Event attendee", "Board or committee member", "Beneficiary of services", "Supporter from a distance"] },
      { key: 'np_motivation', q: "What motivates your support?", exportLabel: "Support Motivation",
        opts: ["Passion for the cause", "Personal connection to the issue", "Community involvement", "Tax benefits", "Social influence — friends or colleagues involved"] },
      { key: 'np_trust', q: "How much do you trust our organization to use resources effectively?", exportLabel: "Trust Level",
        opts: ["Very high trust", "High trust", "Moderate trust", "Some concerns", "Low trust"] },
    ],
  },

  // ── AUTOMOTIVE REPAIR ──────────────────────────────────────────────────────
  automotive_repair: {
    greeting: "Hi! We'd love your feedback on your recent visit. It helps us keep doing what we do best — and fix what we don't.",
    ratingPrompt: "How would you rate your overall experience with our service?",
    promoterQ1: "Great to hear! What did we get right?",
    passiveQ1: "Thanks for sharing. What could we have done better?",
    detractorQ1: "Sorry about that. What was the main issue?",
    q3: "Were there specific aspects — the repair quality, communication, pricing, or wait time — you'd like to comment on?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      pricing: "Was this about the quoted price, the final bill, or unexpected charges?",
      quality: "Was this about the quality of the repair itself, or something else?",
      timing: "Was this about the estimated time, actual time taken, or pickup process?",
    },
    psychographicBank: [
      { key: 'ar_relationship', q: "How do you typically choose an auto repair shop?", exportLabel: "Shop Selection",
        opts: ["Loyalty — I always go to the same place", "Referrals — I ask friends and family", "Reviews — I check online ratings", "Convenience — whoever is closest", "Price — I shop around for the best deal"] },
      { key: 'ar_knowledge', q: "How knowledgeable are you about car maintenance?", exportLabel: "Car Knowledge",
        opts: ["Very knowledgeable — I understand what's needed", "Somewhat knowledgeable — I know the basics", "Limited — I rely on the shop to advise me", "Minimal — I just want it fixed"] },
      { key: 'ar_trust', q: "How much do you trust auto repair shops in general?", exportLabel: "Industry Trust",
        opts: ["High trust — I believe they're honest", "Moderate — I trust but verify", "Low — I'm wary of upselling", "Very low — I often feel taken advantage of"] },
    ],
  },

}

// ── Suggested questions for the Custom Questions step (Step 4) ───────────────
// Contextual / segmentation questions surfaced as one-click additions in the
// study creator. Keyed by industry.

export const INDUSTRY_SUGGESTED_QUESTIONS: Partial<Record<Exclude<Industry, 'other'>, PsychoQuestion[]>> = {

  healthcare: [
    { key: 'i_hc_type',      q: 'What type of healthcare visit was this?',
      exportLabel: 'Visit Type',
      opts: ['Routine check-up', 'Follow-up appointment', 'Urgent care', 'Specialist consultation', 'Procedure or treatment'] },
    { key: 'i_hc_insurance', q: 'How do you typically pay for healthcare?',
      exportLabel: 'Payment Method',
      opts: ['Private insurance', 'Medicare / Medicaid', 'Self-pay', 'Employer-provided insurance', 'Prefer not to say'] },
    { key: 'i_hc_access',    q: 'How easy is it for you to access healthcare when you need it?',
      exportLabel: 'Healthcare Access',
      opts: ['Very easy', 'Fairly easy', 'Neutral', 'Somewhat difficult', 'Very difficult'] },
    { key: 'i_hc_comms',     q: 'How well does our team keep you informed about your care?',
      exportLabel: 'Care Communication',
      opts: ['Extremely well', 'Very well', 'Adequately', 'Not well enough', 'Poorly'] },
  ],

  hospitality: [
    { key: 'i_ho_purpose',   q: 'What is the primary purpose of your stay?',
      exportLabel: 'Stay Purpose',
      opts: ['Leisure / vacation', 'Business', 'Event or celebration', 'Family visit', 'Other'] },
    { key: 'i_ho_booking',   q: 'How did you book your stay?',
      exportLabel: 'Booking Channel',
      opts: ['Direct — hotel website', 'Booking.com', 'Expedia', 'Hotels.com', 'Travel agent', 'Phone or walk-in'] },
    { key: 'i_ho_amenities', q: 'Which amenities are most important to you when choosing a hotel?',
      exportLabel: 'Key Amenity',
      opts: ['Location', 'Price', 'Room quality', 'Breakfast included', 'Pool or gym', 'Free parking', 'Pet-friendly'] },
    { key: 'i_ho_loyalty',   q: 'Are you a member of a hotel loyalty programme?',
      exportLabel: 'Loyalty Programme',
      opts: ['Yes — this hotel chain', 'Yes — a competitor', 'No but I am interested', 'No and not interested'] },
  ],

  casual_dining: [
    { key: 'i_rs_occasion', q: 'What best describes the occasion for your visit today?',
      exportLabel: 'Dining Occasion',
      opts: ['Casual meal', 'Business lunch or dinner', 'Special occasion / celebration', 'Quick bite', 'Family meal'] },
    { key: 'i_rs_group',    q: 'How large was your dining party today?',
      exportLabel: 'Party Size',
      opts: ['Just me', '2 people', '3–4 people', '5 or more people'] },
    { key: 'i_rs_order',    q: 'How did you place your order today?',
      exportLabel: 'Order Method',
      opts: ['Dine-in with server', 'Counter order', 'Mobile app', 'Third-party delivery', 'Drive-through'] },
    { key: 'i_rs_diet',     q: 'Do you have any dietary preferences we should know about?',
      exportLabel: 'Dietary Preference',
      opts: ['No restrictions', 'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Other dietary needs'] },
  ],

  fine_dining: [
    { key: 'i_rs_occasion', q: 'What best describes the occasion for your visit this evening?',
      exportLabel: 'Dining Occasion',
      opts: ['Romantic dinner', 'Business dinner', 'Special celebration', 'Anniversary or birthday', 'Personal treat'] },
    { key: 'i_rs_group',    q: 'How large was your dining party this evening?',
      exportLabel: 'Party Size',
      opts: ['Just me', '2 people', '3–4 people', '5 or more people'] },
    { key: 'i_fd_wine',     q: 'Did you take advantage of our wine or beverage programme?',
      exportLabel: 'Beverage Engagement',
      opts: ['Yes — wine pairing', 'Yes — selected from the list', 'Yes — cocktails', 'No — water or soft drinks only'] },
    { key: 'i_rs_diet',     q: 'Do you have any dietary requirements we should know about for future visits?',
      exportLabel: 'Dietary Requirement',
      opts: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Allergen-related', 'Other'] },
  ],

  fast_food: [
    { key: 'i_ff_channel',  q: 'How did you order today?',
      exportLabel: 'Order Channel',
      opts: ['In-store at the counter', 'Self-service kiosk', 'Drive-through', 'Mobile app', 'Third-party delivery'] },
    { key: 'i_ff_time',     q: 'What time of day was your visit?',
      exportLabel: 'Visit Time',
      opts: ['Breakfast', 'Lunch', 'Afternoon snack', 'Dinner', 'Late night'] },
    { key: 'i_rs_group',    q: 'Who did you order for today?',
      exportLabel: 'Order For',
      opts: ['Just myself', '2 people', '3–4 people', '5 or more people'] },
    { key: 'i_rs_diet',     q: 'Do you have any dietary preferences?',
      exportLabel: 'Dietary Preference',
      opts: ['No restrictions', 'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Other dietary needs'] },
  ],

  travel_tourism: [
    { key: 'i_tr_type',     q: 'What type of trip is this?',
      exportLabel: 'Trip Type',
      opts: ['Solo travel', 'Couple', 'Family with children', 'Group of friends', 'Business travel'] },
    { key: 'i_tr_duration', q: 'How long is your trip?',
      exportLabel: 'Trip Duration',
      opts: ['Day trip', '2–3 nights', '4–7 nights', '1–2 weeks', 'More than 2 weeks'] },
    { key: 'i_tr_plan',     q: 'How far in advance did you plan this trip?',
      exportLabel: 'Planning Lead Time',
      opts: ['Last minute (under a week)', '1–4 weeks', '1–3 months', 'More than 3 months'] },
    { key: 'i_tr_budget',   q: 'How would you describe your travel budget for this trip?',
      exportLabel: 'Travel Budget',
      opts: ['Budget / backpacker', 'Mid-range', 'Comfortable', 'Luxury'] },
  ],

  political: [
    { key: 'i_po_engage',   q: 'How do you most often engage with political issues?',
      exportLabel: 'Political Engagement',
      opts: ['Voting', 'Donating', 'Volunteering', 'Attending events', 'Sharing on social media', 'Following the news'] },
    { key: 'i_po_issues',   q: 'Which issues matter most to you right now?',
      exportLabel: 'Key Issues',
      opts: ['Economy and jobs', 'Healthcare', 'Education', 'Public safety', 'Environment', 'Immigration', 'Other'] },
    { key: 'i_po_trust',    q: 'How much do you trust elected officials to act in your interest?',
      exportLabel: 'Institutional Trust',
      opts: ['A great deal', 'A fair amount', 'Not very much', 'Not at all'] },
  ],

  media_entertainment: [
    { key: 'i_me_type',     q: 'What type of content or entertainment brought you here today?',
      exportLabel: 'Content Type',
      opts: ['Film or cinema', 'Streaming / on-demand', 'Live broadcast', 'Podcast or audio', 'Online video', 'Other'] },
    { key: 'i_en_ticket',   q: 'How did you access or purchase this today?',
      exportLabel: 'Access Method',
      opts: ['Online in advance', 'At the door / box office', 'Via a third-party app', 'Subscription included', 'Complimentary'] },
    { key: 'i_en_group',    q: 'Who did you come with today?',
      exportLabel: 'Attendance Group',
      opts: ['Alone', 'Partner or date', 'Friends', 'Family', 'Work colleagues'] },
  ],

  performing_arts: [
    { key: 'i_en_type',     q: 'What type of performance brought you here today?',
      exportLabel: 'Performance Type',
      opts: ['Theatre or drama', 'Musical theatre', 'Opera or classical music', 'Dance', 'Comedy', 'Other'] },
    { key: 'i_en_ticket',   q: 'How did you purchase your ticket?',
      exportLabel: 'Ticket Channel',
      opts: ['Online in advance', 'At the box office', 'Via a third-party app', 'Complimentary / guest list', 'Subscription or membership'] },
    { key: 'i_en_group',    q: 'Who did you come with today?',
      exportLabel: 'Attendance Group',
      opts: ['Alone', 'Partner or date', 'Friends', 'Family', 'Work colleagues'] },
    { key: 'i_pa_seat',     q: 'How would you rate the sightlines and comfort of your seating?',
      exportLabel: 'Seating Experience',
      opts: ['Excellent', 'Good', 'Adequate', 'Poor', 'Very poor'] },
  ],

  saas_software: [
    { key: 'i_sw_role', q: 'What is your primary role when using this product?',
      exportLabel: 'User Role',
      opts: ['Individual contributor', 'Team lead / manager', 'Executive / decision-maker', 'Administrator', 'Developer / technical'] },
    { key: 'i_sw_tenure', q: 'How long have you been using this product?',
      exportLabel: 'Product Tenure',
      opts: ['Less than a month', '1–6 months', '6–12 months', '1–2 years', 'Over 2 years'] },
    { key: 'i_sw_frequency', q: 'How often do you use this product?',
      exportLabel: 'Usage Frequency',
      opts: ['Multiple times a day', 'Daily', 'A few times a week', 'Weekly', 'Less than weekly'] },
  ],

  retail_ecommerce: [
    { key: 'i_re_channel', q: 'How did you shop with us this time?',
      exportLabel: 'Shopping Channel',
      opts: ['Website on desktop', 'Mobile app', 'Mobile website', 'In-store', 'Phone order'] },
    { key: 'i_re_frequency', q: 'How often do you shop with us?',
      exportLabel: 'Shopping Frequency',
      opts: ['First time', 'A few times a year', 'Monthly', 'Weekly', 'Multiple times a week'] },
    { key: 'i_re_spend', q: 'How would you describe your typical order size with us?',
      exportLabel: 'Order Size',
      opts: ['Small — under $25', 'Medium — $25-$75', 'Large — $75-$150', 'Very large — over $150'] },
  ],

  financial_services: [
    { key: 'i_fs_product', q: 'Which of our products or services do you primarily use?',
      exportLabel: 'Primary Product',
      opts: ['Checking / current account', 'Savings account', 'Credit card', 'Mortgage / loan', 'Investment / wealth management', 'Insurance', 'Multiple products'] },
    { key: 'i_fs_tenure', q: 'How long have you been a customer?',
      exportLabel: 'Customer Tenure',
      opts: ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', 'Over 10 years'] },
    { key: 'i_fs_channel', q: 'How do you most often interact with us?',
      exportLabel: 'Interaction Channel',
      opts: ['Mobile app', 'Online banking website', 'In-branch', 'Phone / call centre', 'ATM'] },
  ],

  education: [
    { key: 'i_ed_role', q: 'What is your relationship to the school?',
      exportLabel: 'Respondent Role',
      opts: ['Parent / guardian', 'Student', 'Teacher / staff', 'Administrator', 'Community member'] },
    { key: 'i_ed_grade', q: 'Which grade level is most relevant to your feedback?',
      exportLabel: 'Grade Level',
      opts: ['Pre-K / Kindergarten', 'Elementary (1-5)', 'Middle school (6-8)', 'High school (9-12)'] },
  ],

  higher_education: [
    { key: 'i_he_status', q: 'What is your current status?',
      exportLabel: 'Student Status',
      opts: ['Undergraduate student', 'Graduate student', 'Doctoral student', 'Alumni', 'Faculty / staff', 'Parent / family'] },
    { key: 'i_he_mode', q: 'What is your primary mode of study?',
      exportLabel: 'Study Mode',
      opts: ['Full-time on-campus', 'Part-time on-campus', 'Fully online', 'Hybrid', 'Evening / weekend'] },
  ],

  hr_employee: [
    { key: 'i_hr_tenure', q: 'How long have you worked at this organization?',
      exportLabel: 'Employee Tenure',
      opts: ['Less than 6 months', '6 months – 1 year', '1–3 years', '3–5 years', '5–10 years', 'Over 10 years'] },
    { key: 'i_hr_level', q: 'What level best describes your role?',
      exportLabel: 'Role Level',
      opts: ['Individual contributor', 'Team lead', 'Manager', 'Director / VP', 'Executive / C-suite'] },
    { key: 'i_hr_remote', q: 'What is your current work arrangement?',
      exportLabel: 'Work Arrangement',
      opts: ['Fully in-office', 'Hybrid (mostly office)', 'Hybrid (mostly remote)', 'Fully remote', 'Field-based'] },
  ],

  sports: [
    { key: 'i_sp_type', q: 'What type of event did you attend?',
      exportLabel: 'Event Type',
      opts: ['Regular season game', 'Playoff / championship', 'Exhibition / friendly', 'Special event', 'Youth / amateur event'] },
    { key: 'i_sp_tickets', q: 'How did you get your tickets?',
      exportLabel: 'Ticket Source',
      opts: ['Season ticket holder', 'Purchased online in advance', 'Bought at the venue', 'Secondary market (StubHub, etc.)', 'Complimentary / gift'] },
    { key: 'i_sp_group', q: 'Who did you come with today?',
      exportLabel: 'Attendance Group',
      opts: ['Alone', 'Partner', 'Friends', 'Family with kids', 'Corporate / business group'] },
  ],

  nonprofit: [
    { key: 'i_np_involvement', q: 'How are you involved with our organization?',
      exportLabel: 'Involvement Type',
      opts: ['Donor', 'Volunteer', 'Event attendee', 'Program participant', 'Board / committee member', 'Staff'] },
    { key: 'i_np_tenure', q: 'How long have you been involved with us?',
      exportLabel: 'Involvement Duration',
      opts: ['Less than 1 year', '1–3 years', '3–5 years', 'Over 5 years'] },
  ],

  automotive_repair: [
    { key: 'i_ar_service', q: 'What type of service did you come in for?',
      exportLabel: 'Service Type',
      opts: ['Routine maintenance (oil change, tires, etc.)', 'Specific repair', 'Diagnostic / inspection', 'Warranty work', 'Body / collision repair'] },
    { key: 'i_ar_vehicle', q: 'How old is the vehicle you brought in?',
      exportLabel: 'Vehicle Age',
      opts: ['Under 1 year', '1–3 years', '4–7 years', '8–12 years', 'Over 12 years'] },
    { key: 'i_ar_first', q: 'Is this your first visit to our shop?',
      exportLabel: 'First Visit',
      opts: ['Yes — first time', 'No — been here before', 'No — regular customer'] },
  ],

}
