// lib/industryDefaults.ts
// Default study config values per industry

import type { StudyConfig } from './types'

export type Industry =
  | 'healthcare' | 'hospitality' | 'restaurants'
  | 'travel' | 'politics' | 'entertainment' | 'other'

export const INDUSTRY_LABELS: Record<Industry, string> = {
  healthcare:    'Healthcare',
  hospitality:   'Hospitality (Hotel / Lodging)',
  restaurants:   'Restaurants & Dining',
  travel:        'Travel & Tourism',
  politics:      'Politics & Advocacy',
  entertainment: 'Entertainment & Events',
  other:         'Other / Custom',
}

type Defaults = Pick<StudyConfig,
  'greeting' | 'ratingPrompt' |
  'promoterQ1' | 'passiveQ1' | 'detractorQ1' |
  'q3' | 'q4' | 'clarifiers' | 'psychographicBank'
>

export const INDUSTRY_DEFAULTS: Record<Exclude<Industry, 'other'>, Defaults> = {

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
      { key: 'patient_type', q: "Which best describes your visit today?", exportLabel: "Patient Type",
        opts: ["New patient", "Returning patient", "Emergency / urgent care", "Follow-up appointment", "Procedure or surgery"] },
      { key: 'visit_frequency', q: "How often do you visit our facility?", exportLabel: "Visit Frequency",
        opts: ["First time", "A few times a year", "Monthly", "Weekly or more", "As needed"] },
      { key: 'primary_concern', q: "What was the primary reason for your visit?", exportLabel: "Primary Concern",
        opts: ["Routine check-up", "Illness or injury", "Chronic condition management", "Mental health", "Specialist referral"] },
      { key: 'insurance_type', q: "How is your care typically covered?", exportLabel: "Insurance Type",
        opts: ["Private insurance", "Medicare / Medicaid", "Self-pay", "Workers' compensation", "Prefer not to say"] },
      { key: 'age_range', q: "Which age group do you fall into?", exportLabel: "Age Range",
        opts: ["18–34", "35–49", "50–64", "65 or over", "Prefer not to say"] },
    ],
  },

  hospitality: {
    greeting: "Hi — I'm here to gather your feedback about your stay with us. We genuinely value your thoughts and would love to hear how we did.",
    ratingPrompt: "How would you rate your overall stay experience?",
    promoterQ1: "Wonderful! What made your stay particularly memorable?",
    passiveQ1: "Thank you for staying with us. What could we have done to make your visit even more enjoyable?",
    detractorQ1: "I'm sorry your stay didn't meet your expectations. What was the main issue you experienced?",
    q3: "Were there any specific areas — check-in, your room, dining, or service — you'd particularly like to comment on?",
    q4: "Is there anything else you'd like us to know before you go?",
    clarifiers: {
      default: "Could you tell me a little more about that?",
      room: "What specifically about the room are you referring to?",
      staff: "Which part of our team are you referring to, and what happened?",
      cleanliness: "Which area or item are you referring to when it comes to cleanliness?",
    },
    psychographicBank: [
      { key: 'travel_purpose', q: "What was the primary purpose of your stay?", exportLabel: "Travel Purpose",
        opts: ["Leisure / vacation", "Business", "Conference or event", "Special occasion", "Passing through"] },
      { key: 'party_type', q: "Who did you travel with?", exportLabel: "Travel Party",
        opts: ["Alone", "Couple", "Family with children", "Group of friends", "Business colleagues"] },
      { key: 'stay_frequency', q: "How often do you stay at properties like ours?", exportLabel: "Stay Frequency",
        opts: ["First time here", "Once a year", "A few times a year", "Monthly or more", "First time in this area"] },
      { key: 'booking_channel', q: "How did you book your stay?", exportLabel: "Booking Channel",
        opts: ["Direct / hotel website", "OTA (Expedia, Booking.com etc.)", "Travel agent", "Corporate booking", "Loyalty programme"] },
      { key: 'room_type', q: "What type of room did you stay in?", exportLabel: "Room Type",
        opts: ["Standard / queen", "King", "Suite", "Accessible room", "Other"] },
    ],
  },

  restaurants: {
    greeting: "Hi — I'm here to collect your feedback about your dining experience today. It only takes a few minutes and helps us do better!",
    ratingPrompt: "How would you rate your overall dining experience today?",
    promoterQ1: "Fantastic! What made your meal or visit stand out?",
    passiveQ1: "Thanks for dining with us. What could we have done to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. What let you down about your experience today?",
    q3: "Were there any specific aspects — the food, service, atmosphere, or wait time — you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      food: "Which dish or item are you referring to?",
      service: "Was this about speed of service, attentiveness, or something else?",
      wait: "How long did you wait, and at what point — getting seated, ordering, or receiving your food?",
    },
    psychographicBank: [
      { key: 'visit_occasion', q: "What brought you in today?", exportLabel: "Visit Occasion",
        opts: ["Casual meal out", "Special occasion", "Business lunch or dinner", "Quick bite", "First time trying us"] },
      { key: 'party_size', q: "How large was your group?", exportLabel: "Party Size",
        opts: ["Just me", "2 people", "3–4 people", "5 or more"] },
      { key: 'visit_frequency', q: "How often do you dine with us?", exportLabel: "Visit Frequency",
        opts: ["First time", "Occasionally", "A few times a month", "Weekly or more"] },
      { key: 'discovery', q: "How did you hear about us?", exportLabel: "Discovery Channel",
        opts: ["Word of mouth", "Social media", "Google / search", "Walked past", "Returning regular"] },
      { key: 'meal_period', q: "Which meal period was your visit?", exportLabel: "Meal Period",
        opts: ["Breakfast", "Brunch", "Lunch", "Dinner", "Late night"] },
    ],
  },

  travel: {
    greeting: "Hi — I'm here to collect your feedback about your recent travel experience with us. Your input helps us make every journey better.",
    ratingPrompt: "How would you rate your overall travel experience with us?",
    promoterQ1: "Great to hear! What stood out most about your journey?",
    passiveQ1: "Thank you for travelling with us. What could we have done to improve your experience?",
    detractorQ1: "I'm sorry the journey didn't meet your expectations. What was the main issue?",
    q3: "Were there any specific touchpoints — booking, check-in, in-journey, or arrival — you'd like to comment on?",
    q4: "Is there anything else about your travel experience you'd like to share?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      delay: "How long was the delay and how were you informed about it?",
      staff: "At which stage of your journey did this happen?",
      booking: "Was this a problem with the booking process itself, or something that came up later?",
    },
    psychographicBank: [
      { key: 'trip_purpose', q: "What was the purpose of your trip?", exportLabel: "Trip Purpose",
        opts: ["Leisure / holiday", "Business travel", "Visiting family or friends", "Honeymoon / special occasion", "Group or packaged tour"] },
      { key: 'travel_frequency', q: "How often do you travel?", exportLabel: "Travel Frequency",
        opts: ["Rarely (once a year or less)", "A few times a year", "Monthly", "Weekly or more"] },
      { key: 'booking_method', q: "How did you book your travel?", exportLabel: "Booking Method",
        opts: ["Direct with the provider", "OTA (Expedia, Kayak etc.)", "Travel agent", "Corporate travel desk", "Loyalty app"] },
      { key: 'party_type', q: "Who did you travel with?", exportLabel: "Travel Party",
        opts: ["Solo", "Couple", "Family with children", "Group of friends", "Business colleagues"] },
      { key: 'destination_type', q: "Which best describes your destination?", exportLabel: "Destination Type",
        opts: ["Domestic city break", "Domestic longer trip", "International short-haul", "International long-haul", "Cruise or expedition"] },
    ],
  },

  politics: {
    greeting: "Hi — I'm here to gather your feedback about today's event or outreach. Your voice matters and we'd love to hear from you.",
    ratingPrompt: "How would you rate your overall experience at today's event or interaction?",
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
      { key: 'voter_status', q: "Are you a registered voter in this area?", exportLabel: "Voter Status",
        opts: ["Yes, registered here", "Yes, registered elsewhere", "Not currently registered", "Prefer not to say"] },
      { key: 'engagement_level', q: "How engaged are you in local or national politics?", exportLabel: "Engagement Level",
        opts: ["Very engaged — I follow closely", "Somewhat engaged", "Occasionally interested", "Not usually engaged"] },
      { key: 'top_issue', q: "Which issue matters most to you right now?", exportLabel: "Top Issue",
        opts: ["Economy & jobs", "Healthcare", "Education", "Public safety", "Climate & environment", "Immigration", "Other"] },
      { key: 'political_lean', q: "How would you describe your political leaning?", exportLabel: "Political Leaning",
        opts: ["Progressive / left", "Centre-left", "Centrist", "Centre-right", "Conservative / right", "Prefer not to say"] },
      { key: 'local_area', q: "Which area do you primarily identify with?", exportLabel: "Geographic Area",
        opts: ["Urban", "Suburban", "Rural", "Small town", "Prefer not to say"] },
    ],
  },

  entertainment: {
    greeting: "Hi — I'm here to collect your feedback about today's event or experience. It only takes a moment and really helps us improve!",
    ratingPrompt: "How would you rate your overall experience today?",
    promoterQ1: "Amazing! What was the highlight of the experience for you?",
    passiveQ1: "Glad you came! What could we have done to make it even more memorable?",
    detractorQ1: "I'm sorry it didn't live up to expectations. What let you down?",
    q3: "Were there any specific aspects — the content, venue, staff, or logistics — you'd like to comment on?",
    q4: "Is there anything else you'd like to share about today?",
    clarifiers: {
      default: "Could you tell me a little more about that?",
      venue: "Was this about the physical space, seating, facilities, or something else?",
      content: "Which part of the show, performance, or programme are you referring to?",
      queue: "Where did the queuing issue occur — entry, bar, merchandise, or elsewhere?",
    },
    psychographicBank: [
      { key: 'attendance_frequency', q: "How often do you attend events like this?", exportLabel: "Attendance Frequency",
        opts: ["First time", "Once a year", "A few times a year", "Monthly", "Very regularly"] },
      { key: 'discovery', q: "How did you hear about this event?", exportLabel: "Discovery Channel",
        opts: ["Social media", "Friend or family recommendation", "Email or newsletter", "Search / website", "Saw an advert"] },
      { key: 'group_size', q: "Who did you come with today?", exportLabel: "Group Composition",
        opts: ["Came alone", "With a partner", "With friends", "With family", "With a work group"] },
      { key: 'content_preference', q: "What type of content do you enjoy most?", exportLabel: "Content Preference",
        opts: ["Live music", "Comedy", "Theatre / drama", "Film", "Sport", "Family entertainment", "Other"] },
      { key: 'age_group', q: "Which age group do you fall into?", exportLabel: "Age Group",
        opts: ["Under 18", "18–25", "26–40", "41–60", "Over 60"] },
    ],
  },
}
