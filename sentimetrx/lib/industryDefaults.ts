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
      { key: 'me_discovery_behaviour', q: "How do you typically discover new content to watch or engage with?", exportLabel: "Discovery Behaviour",
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

}
