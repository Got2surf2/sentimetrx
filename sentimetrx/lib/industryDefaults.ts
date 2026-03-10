// lib/industryDefaults.ts
// Default study config values per industry

import type { StudyConfig } from './types'

export type Industry =
  | 'automotive_repair'
  | 'casual_dining'
  | 'education'
  | 'fast_food'
  | 'financial_services'
  | 'fine_dining'
  | 'hr_employee'
  | 'healthcare'
  | 'higher_education'
  | 'hospitality'
  | 'media_entertainment'
  | 'nonprofits'
  | 'performing_arts'
  | 'political'
  | 'retail_ecommerce'
  | 'saas_software'
  | 'sports'
  | 'travel_tourism'
  | 'other'

export const INDUSTRY_LABELS: Record<Industry, string> = {
  automotive_repair:   'Automotive Repair',
  casual_dining:       'Casual Dining',
  education:           'Education',
  fast_food:           'Fast Food',
  financial_services:  'Financial Services',
  fine_dining:         'Fine Dining',
  hr_employee:         'HR / Employee Experience',
  healthcare:          'Healthcare',
  higher_education:    'Higher Education',
  hospitality:         'Hospitality / Hotels',
  media_entertainment: 'Media / Entertainment',
  nonprofits:          'Non-Profits',
  performing_arts:     'Performing Arts / Venues',
  political:           'Political Opinion Survey',
  retail_ecommerce:    'Retail / E-commerce',
  saas_software:       'SaaS / Software',
  sports:              'Sports',
  travel_tourism:      'Travel / Tourism',
  other:               'Other / Custom',
}

type Defaults = Pick<StudyConfig,
  'greeting' | 'ratingPrompt' |
  'promoterQ1' | 'passiveQ1' | 'detractorQ1' |
  'q3' | 'q4' | 'clarifiers' | 'psychographicBank' |
  'npsPrompt' | 'npsFollowUp' | 'experienceFollowUp'
>

export const INDUSTRY_DEFAULTS: Record<Exclude<Industry, 'other'>, Defaults> = {

  automotive_repair: {
    greeting: "Hi -- thanks for choosing us for your vehicle service. We'd love to hear about your experience today.",
    ratingPrompt: "How would you rate your overall service experience today?",
    promoterQ1: "That's great to hear! What stood out most about the service you received?",
    passiveQ1: "Thank you for the feedback. What could we have done to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. What fell short of your expectations today?",
    q3: "Was there anything about the communication, wait time, or quality of work you'd like to highlight?",
    q4: "Is there anything else you'd like us to know about your visit?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      wait: "How long did you wait, and did we keep you informed during that time?",
      price: "Was the pricing unclear upfront, or did the final cost differ from your expectation?",
      quality: "Which aspect of the work are you referring to?",
    },
    psychographicBank: [
      { key: 'ar_p_involvement', q: "How involved do you like to be in decisions about your vehicle's maintenance?", exportLabel: "Maintenance Involvement",
        opts: ["I trust my provider completely — tell me what needs doing", "I like to understand the basics before agreeing", "I research everything before authorising work", "I prefer to handle what I can myself"] },
      { key: 'ar_p_provider_values', q: "What matters most to you when choosing a service provider?", exportLabel: "Provider Values",
        opts: ["Price and value for money", "Technical expertise and quality", "Speed and convenience", "Honesty and transparency", "Relationship and familiarity"] },
      { key: 'ar_p_car_identity', q: "How would you describe your relationship with your vehicle?", exportLabel: "Vehicle Relationship",
        opts: ["It's purely practical — a way to get around", "I take pride in keeping it in good condition", "It's part of my lifestyle or identity", "It's a significant investment I want to protect"] },
      { key: 'ar_p_surprise', q: "When an unexpected repair comes up, what's your first instinct?", exportLabel: "Unexpected Repair Response",
        opts: ["I trust my regular provider to advise me", "I get multiple quotes before deciding", "I research the issue online first", "I ask friends or family for recommendations"] },
    ],
    npsPrompt: "How likely are you to recommend our garage to a friend or colleague?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's disappointing to hear. What would need to change before you'd feel comfortable recommending us?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for being honest. Was there a specific part of the service that let you down?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What's the main thing that's stopping you from recommending us right now?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear! What one improvement would make you a definite recommender?", clarify: false, useAI: false },
          "5": { prompt: "That means a lot — thank you! What would you tell a friend about us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're really sorry about that. Was it the quality of the work, the communication, or something else that fell short?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for letting us know. What was the biggest frustration during your visit?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made your service experience stand out?", clarify: false, useAI: false },
          "4": { prompt: "Glad it was a good visit! Is there anything we could polish to make it even better?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful to hear! What made this visit particularly positive for you?", clarify: false, useAI: false }
        }
      },
  },

  casual_dining: {
    greeting: "Hi -- thanks for dining with us today! We'd love to hear how your experience was.",
    ratingPrompt: "How would you rate your overall dining experience today?",
    promoterQ1: "Fantastic! What made your meal or visit stand out?",
    passiveQ1: "Thanks for dining with us. What could we have done to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. What let you down about your experience today?",
    q3: "Were there any specific aspects -- the food, service, atmosphere, or wait time -- you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      food: "Which dish or item are you referring to?",
      service: "Was this about speed of service, attentiveness, or something else?",
      wait: "How long did you wait, and at what point -- being seated, ordering, or receiving your food?",
    },
    psychographicBank: [
      { key: 'cd_p_role', q: "What role does dining out play in your life?", exportLabel: "Dining Role",
        opts: ["Mainly convenience — I'm time poor", "A social ritual I genuinely enjoy", "A treat for special occasions", "A regular part of my lifestyle"] },
      { key: 'cd_p_choice_driver', q: "What matters most when you choose where to eat?", exportLabel: "Restaurant Choice Driver",
        opts: ["Food quality and freshness", "Value for money", "Convenience and location", "Atmosphere and vibe", "Recommendations and reviews"] },
      { key: 'cd_p_adventure', q: "How adventurous are you when it comes to food?", exportLabel: "Food Adventurousness",
        opts: ["I stick to familiar favourites", "I occasionally try something new", "I love exploring new cuisines and dishes", "Food discovery is a real passion of mine"] },
      { key: 'cd_p_conscious', q: "How conscious are you about what you eat?", exportLabel: "Food Consciousness",
        opts: ["I don't pay much attention", "I'm occasionally mindful", "I try to make healthy or ethical choices", "My food values are central to how I live"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. What went wrong that would make you hesitate to recommend us?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for your honesty. Was it the food, the service, or the atmosphere that let you down?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What would need to be different for you to feel excited about recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Great to hear! What one thing would make you a wholehearted recommender?", clarify: false, useAI: false },
          "5": { prompt: "That's so lovely to hear! What would you tell a friend who asked about us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're really sorry your experience didn't meet expectations. Was it the food, the wait, or the service that was the main issue?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for sharing that. What disappointed you most during your visit?", clarify: false, useAI: false },
          "3": { prompt: "Thanks for the feedback. What would have made your meal feel like a truly great experience?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you enjoyed it! Is there one small thing we could improve?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful! What made your visit stand out today?", clarify: false, useAI: false }
        }
      },
  },

  education: {
    greeting: "Hi -- thank you for taking a moment to share your feedback. Your input helps us make our school community better for everyone.",
    ratingPrompt: "How would you rate your overall experience with our school this year?",
    promoterQ1: "That's wonderful to hear! What has been most positive about your experience?",
    passiveQ1: "Thank you for sharing. What could we do to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. What area has caused the most concern for you?",
    q3: "Are there specific programs, staff, or processes you'd like to highlight -- positively or as areas to improve?",
    q4: "Is there anything else you'd like us to know about your experience?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      teacher: "Which subject or classroom are you referring to?",
      communication: "What type of communication are you referring to -- updates, reports, or something else?",
      safety: "Could you share more about the safety concern you have in mind?",
    },
    psychographicBank: [
      { key: 'ed_p_motivation', q: "What is your primary motivation for learning?", exportLabel: "Learning Motivation",
        opts: ["Career advancement or job requirements", "Personal growth and self-improvement", "Curiosity and love of learning", "Meeting a qualification requirement", "Helping others in my community"] },
      { key: 'ed_p_style', q: "How do you learn best?", exportLabel: "Learning Style",
        opts: ["Structured lectures and clear instructions", "Hands-on and practical activities", "Independent exploration at my own pace", "Collaborative group learning", "Mixed approaches"] },
      { key: 'ed_p_challenge', q: "How do you respond when learning feels challenging?", exportLabel: "Challenge Response",
        opts: ["I push through — I see challenge as growth", "I seek support from others", "I sometimes lose confidence and disengage", "I reassess whether the goal is right for me"] },
      { key: 'ed_p_future', q: "How would you describe your outlook on education's role in your life?", exportLabel: "Education Outlook",
        opts: ["A means to an end — qualifications and career", "An ongoing journey throughout life", "Important but not always accessible", "Something I've had mixed experiences with"] },
    ],
    npsPrompt: "How likely are you to recommend this programme or institution to someone in a similar situation?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's important feedback — thank you. What's the main reason you'd hesitate to recommend us?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate your honesty. What has fallen short of your expectations?", clarify: false, useAI: false },
          "3": { prompt: "Thanks for that. What would need to improve for you to feel more confident recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear! What one thing would tip you to a definite yes?", clarify: false, useAI: false },
          "5": { prompt: "That means a lot! What would you highlight to someone considering joining us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry your experience hasn't been positive. Was it the teaching, the support, the resources, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for being candid. What aspect of your learning experience has disappointed you most?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate your feedback. What change would make the biggest positive difference for you?", clarify: false, useAI: false },
          "4": { prompt: "Really glad to hear that. What one improvement would make the experience exceptional?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant! What has stood out most about your experience with us?", clarify: false, useAI: false }
        }
      },
  },

  fast_food: {
    greeting: "Hi -- thanks for visiting us today! We'd love to hear about your experience. It only takes a minute.",
    ratingPrompt: "How would you rate your overall experience today?",
    promoterQ1: "Great to hear! What made your visit stand out?",
    passiveQ1: "Thank you for stopping by. What could we have done better today?",
    detractorQ1: "I'm sorry your experience didn't meet expectations. What was the main issue?",
    q3: "Was there anything specific about your order, the wait, or the service that you'd like to mention?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      wait: "How long did you wait, and where did the delay happen?",
      order: "Was this an issue with accuracy, temperature, or something else?",
      staff: "Was this at the counter, drive-through, or another point of contact?",
    },
    psychographicBank: [
      { key: 'ff_p_visit_driver', q: "What most often drives you to visit a fast food restaurant?", exportLabel: "Visit Driver",
        opts: ["Speed — I'm in a rush", "Convenience — it's close by", "Price — it fits my budget", "Habit — I come regularly", "A specific craving"] },
      { key: 'ff_p_priorities', q: "What matters most to you when ordering fast food?", exportLabel: "Fast Food Priorities",
        opts: ["Consistency — I want the same every time", "Speed of service", "Value and portion size", "Healthier or fresher options", "Variety in the menu"] },
      { key: 'ff_p_health', q: "How much does health factor into your fast food choices?", exportLabel: "Health Consideration",
        opts: ["Rarely — I treat it as an indulgence", "Sometimes — I'll pick the lighter option if it's there", "Often — I look for grilled, salad or lower-calorie choices", "Always — I avoid it where possible"] },
      { key: 'ff_p_loyalty', q: "Are you loyal to a specific fast food chain?", exportLabel: "Chain Loyalty",
        opts: ["Yes — I have one or two I always go to", "I go wherever is closest or open", "I rotate based on cravings or deals", "I try to explore different options"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "Sorry to hear that. What went wrong that you'd want us to fix?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for telling us. Was it the speed, the food, or the service that let you down?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What would make you more likely to recommend us next time?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear! What would make you an enthusiastic recommender?", clarify: false, useAI: false },
          "5": { prompt: "Awesome — thank you! What would you tell a friend about us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "Sorry your experience wasn't great. Was it the food quality, wait time, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for letting us know. What was the biggest issue with your order today?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made this visit better?", clarify: false, useAI: false },
          "4": { prompt: "Glad you had a decent experience! Anything we could do even better next time?", clarify: false, useAI: false },
          "5": { prompt: "Love to hear it! What made your visit a great one today?", clarify: false, useAI: false }
        }
      },
  },

  financial_services: {
    greeting: "Hi -- we value your feedback about your experience with us. Your input helps us serve you better.",
    ratingPrompt: "How would you rate your overall experience with us today?",
    promoterQ1: "That's great to hear! What has made your experience with us particularly positive?",
    passiveQ1: "Thank you for your feedback. What could we do to serve you even better?",
    detractorQ1: "I'm sorry to hear that. What aspect of your experience fell short?",
    q3: "Were there any specific interactions, processes, or products you'd like to highlight?",
    q4: "Is there anything else you'd like us to know about your experience?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      fees: "Which fees or charges are you referring to?",
      process: "Which step of the process caused frustration?",
      staff: "Was this with a specific team or department?",
    },
    psychographicBank: [
      { key: 'fs_p_money_attitude', q: "How would you describe your general attitude towards money?", exportLabel: "Money Attitude",
        opts: ["A saver — I plan carefully and build reserves", "A balancer — I enjoy life but watch what I spend", "A spender — I focus on experiences over saving", "Uncertain — money management is a source of stress"] },
      { key: 'fs_p_trust', q: "What is most important to you in a financial services relationship?", exportLabel: "Financial Trust Drivers",
        opts: ["Transparency about fees and charges", "Expertise and sound advice", "Accessibility and responsiveness", "A personalised approach to my situation", "Long-term track record and reputation"] },
      { key: 'fs_p_risk', q: "How would you describe your attitude to financial risk?", exportLabel: "Risk Appetite",
        opts: ["Very cautious — I prioritise security above all", "Somewhat cautious — I take calculated risks", "Balanced — I'm comfortable with moderate risk", "Growth-oriented — I'm willing to take risk for better returns"] },
      { key: 'fs_p_involvement', q: "How involved do you like to be in managing your finances?", exportLabel: "Financial Involvement",
        opts: ["I prefer to hand it over to experts", "I like to be informed but not in the detail", "I stay closely involved in all decisions", "I'm building my knowledge as I go"] },
    ],
    npsPrompt: "How likely are you to recommend our services to a colleague, friend, or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We take that seriously — thank you. What's the primary reason you wouldn't recommend us?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate you sharing that. What has fallen short of your expectations?", clarify: false, useAI: false },
          "3": { prompt: "Thank you for the feedback. What would need to change for you to feel confident recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Great to hear. What single improvement would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's wonderful — thank you! What would you say to someone asking about our services?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry your experience didn't meet your expectations. Was it clarity, responsiveness, or outcome that fell short?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for that candid feedback. What was the most significant frustration?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your honesty. What change would have made the biggest positive difference?", clarify: false, useAI: false },
          "4": { prompt: "Glad your experience was positive. What one thing could we do better?", clarify: false, useAI: false },
          "5": { prompt: "Excellent to hear! What made this experience stand out for you?", clarify: false, useAI: false }
        }
      },
  },

  fine_dining: {
    greeting: "Good evening -- thank you for joining us tonight. Your feedback helps us create exceptional experiences for every guest.",
    ratingPrompt: "How would you rate your overall dining experience tonight?",
    promoterQ1: "We're delighted to hear that! What made your evening most memorable?",
    passiveQ1: "Thank you for dining with us. What could we have done to elevate your experience further?",
    detractorQ1: "We sincerely apologize that tonight did not meet your expectations. What fell short?",
    q3: "Were there any specific moments -- the food, service, wine, or atmosphere -- you'd like to share thoughts on?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you share a little more about that?",
      food: "Which course or dish are you referring to?",
      service: "Was this about pacing, attentiveness, or knowledge of the menu and wine list?",
      atmosphere: "Was this about the noise level, lighting, temperature, or something else?",
    },
    psychographicBank: [
      { key: 'fd_p_occasion', q: "When you choose fine dining, what is the occasion?", exportLabel: "Dining Occasion Mindset",
        opts: ["A special personal celebration", "A professional or client entertainment context", "A deliberate experience — I seek out great restaurants", "An anniversary, romantic, or milestone event"] },
      { key: 'fd_p_values', q: "What matters most to you in a fine dining experience?", exportLabel: "Fine Dining Values",
        opts: ["The quality and creativity of the food", "The service — attentive, knowledgeable, warm", "The atmosphere and overall sense of occasion", "Provenance, sustainability and ethical sourcing", "Exclusivity and prestige"] },
      { key: 'fd_p_food_knowledge', q: "How would you describe your level of food and wine knowledge?", exportLabel: "Culinary Knowledge",
        opts: ["I'm a novice who enjoys learning", "I have a solid working knowledge", "I'm well-informed and passionate", "It's a serious interest — I follow trends and chefs closely"] },
      { key: 'fd_p_social', q: "Do you share your dining experiences with others?", exportLabel: "Social Sharing Behaviour",
        opts: ["Privately — dining is personal", "Occasionally with close friends", "Yes — I recommend places to others", "Actively — I post, review and write about food"] },
    ],
    npsPrompt: "How likely are you to recommend us to friends, family, or colleagues for a special occasion?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're truly sorry to hear that. What fell short of the standard you expected?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for your honesty. Was it the cuisine, the service, or the ambience that disappointed?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your feedback. What would have elevated your experience to something you'd enthusiastically recommend?", clarify: false, useAI: false },
          "4": { prompt: "Delightful to hear. What one refinement would make you a firm advocate?", clarify: false, useAI: false },
          "5": { prompt: "That means the world to us. What stood out that you'd share with others?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We sincerely apologise. Was it the food, the service, or the atmosphere that fell below expectations?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for telling us. What was the most significant disappointment this evening?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your candour. What would have made this a truly memorable dining experience?", clarify: false, useAI: false },
          "4": { prompt: "We're so pleased you enjoyed your visit. What one detail could we refine further?", clarify: false, useAI: false },
          "5": { prompt: "What a joy to hear. What made this evening particularly special for you?", clarify: false, useAI: false }
        }
      },
  },

  hr_employee: {
    greeting: "Hi -- thank you for taking a few minutes to share your experience as a member of our team. Your feedback is completely confidential.",
    ratingPrompt: "How would you rate your overall employee experience right now?",
    promoterQ1: "That's great to hear! What is making your experience most positive?",
    passiveQ1: "Thank you for sharing. What would make the biggest difference to your experience at work?",
    detractorQ1: "I'm sorry to hear that. What is having the biggest negative impact on your experience?",
    q3: "Are there any specific aspects of your day-to-day work, your team, or the broader organisation you'd like to highlight?",
    q4: "Is there anything else you'd like leadership to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      manager: "Is this about your direct manager, skip-level management, or leadership more broadly?",
      process: "Which process or system is causing the most friction?",
      culture: "Could you give me a specific example of what you're experiencing?",
    },
    psychographicBank: [
      { key: 'hr_p_work_identity', q: "How central is work to your personal identity?", exportLabel: "Work Identity",
        opts: ["Work is central — it defines a lot of who I am", "Work is important but separate from who I am", "Work is a means to live the life I want", "I'm currently reassessing what work means to me"] },
      { key: 'hr_p_motivation', q: "What motivates you most at work?", exportLabel: "Work Motivation",
        opts: ["Making a meaningful difference", "Learning and growing my skills", "Earning well and being rewarded fairly", "Being part of a strong team", "Autonomy and control over my work"] },
      { key: 'hr_p_culture', q: "What kind of workplace culture do you thrive in?", exportLabel: "Culture Preference",
        opts: ["High performance and ambitious", "Collaborative and supportive", "Flexible and autonomous", "Stable, structured and predictable", "Innovative and fast-paced"] },
      { key: 'hr_p_balance', q: "How do you feel about work-life balance right now?", exportLabel: "Work-Life Balance",
        opts: ["I feel well balanced", "I lean toward work but it's mostly by choice", "I'd like more balance but it's not always possible", "Balance is a significant challenge for me right now"] },
    ],
    npsPrompt: "How likely are you to recommend this organisation as a great place to work to someone you know?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's important to understand — thank you. What is the primary reason you feel that way?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate you sharing that. What aspect of working here has been most challenging?", clarify: false, useAI: false },
          "3": { prompt: "Thank you for your honest feedback. What one change would make you more likely to recommend us as an employer?", clarify: false, useAI: false },
          "4": { prompt: "Really good to hear. What would make you an enthusiastic advocate for working here?", clarify: false, useAI: false },
          "5": { prompt: "That means a lot. What would you tell someone considering joining the team?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear your experience has been difficult. Is it related to culture, management, workload, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for being open with us. What has had the biggest negative impact on your experience?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your honesty. What one improvement would make the biggest difference to you?", clarify: false, useAI: false },
          "4": { prompt: "Really glad to hear things are going well. What one thing could we do better?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant — thank you! What makes your experience here stand out for you?", clarify: false, useAI: false }
        }
      },
  },

  healthcare: {
    greeting: "Hi -- I'm here to gather your feedback about your recent care experience. It'll only take a few minutes, and your input genuinely helps us improve.",
    ratingPrompt: "How would you rate your overall care experience today?",
    promoterQ1: "That's wonderful to hear! What stood out most about the care you received?",
    passiveQ1: "Thank you for sharing that. What could we have done to make your experience even better?",
    detractorQ1: "I'm sorry to hear that. Which aspect of your care experience fell short of your expectations?",
    q3: "Were there any specific moments -- with staff, the facility, or the process -- that you'd like to highlight?",
    q4: "Is there anything else about your visit today you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      wait: "How long did you have to wait, and how did that affect your experience?",
      staff: "Which member of staff are you referring to, and what happened?",
      communication: "What information do you feel was missing or unclear?",
    },
    psychographicBank: [
      { key: 'hc_p_health_attitude', q: "How would you describe your overall approach to your health?", exportLabel: "Health Attitude",
        opts: ["Proactive — I invest in prevention and wellness", "Reactive — I address issues when they arise", "Cautious — I monitor closely but worry often", "Pragmatic — I do what's needed but no more"] },
      { key: 'hc_p_provider_values', q: "What matters most to you in a healthcare relationship?", exportLabel: "Healthcare Values",
        opts: ["Being listened to and treated as a person", "Technical expertise and accuracy", "Clear communication about my options", "Continuity — seeing someone who knows my history", "Ease of access and minimal waiting"] },
      { key: 'hc_p_involvement', q: "How involved do you want to be in decisions about your care?", exportLabel: "Care Involvement",
        opts: ["I prefer to be guided by the professional", "I like shared decision-making", "I research thoroughly and come with questions", "I advocate strongly for my own preferences"] },
      { key: 'hc_p_trust', q: "How do you feel about the healthcare system generally?", exportLabel: "Healthcare System Trust",
        opts: ["Very trusting — I have confidence in the system", "Mostly trusting with occasional concerns", "Sceptical — I prefer to do my own research", "Frustrated — I've had difficult experiences"] },
    ],
    npsPrompt: "How likely are you to recommend our practice or facility to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're truly sorry to hear that. Can you share what led to that feeling so we can address it?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for being candid. What was it about your experience that fell short?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate that feedback. What would need to improve for you to feel confident recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear. What one change would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's wonderful — thank you. What would you tell someone who was considering coming to us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're very sorry. Was it related to your care, the communication, or the waiting experience?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for sharing that. What was the most significant concern about your visit?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your honesty. What improvement would have made the most meaningful difference today?", clarify: false, useAI: false },
          "4": { prompt: "Really glad your experience was positive. What could we do even better?", clarify: false, useAI: false },
          "5": { prompt: "That's so good to hear. What stood out most about the care you received today?", clarify: false, useAI: false }
        }
      },
  },

  higher_education: {
    greeting: "Hi -- thank you for sharing your experience with us. Your feedback helps us continually improve the quality of our academic community.",
    ratingPrompt: "How would you rate your overall experience at our institution?",
    promoterQ1: "That's great to hear! What has been the highlight of your experience?",
    passiveQ1: "Thank you for your feedback. What would make the biggest difference to your experience?",
    detractorQ1: "I'm sorry to hear that. What has had the greatest negative impact on your experience?",
    q3: "Are there specific academic programs, support services, or facilities you'd like to comment on?",
    q4: "Is there anything else you'd like us to know about your experience?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      professor: "Which department or type of course are you referring to?",
      services: "Which student service or administrative office are you referring to?",
      campus: "Which area of campus or which facility are you referring to?",
    },
    psychographicBank: [
      { key: 'he_p_purpose', q: "Why did you choose to pursue higher education?", exportLabel: "HE Purpose",
        opts: ["To qualify for a specific career path", "For the experience and personal growth", "Because it was expected or encouraged", "To develop expertise in something I'm passionate about", "To increase my earning potential"] },
      { key: 'he_p_ambition', q: "How would you describe your academic ambition?", exportLabel: "Academic Ambition",
        opts: ["I'm here to achieve the highest results I can", "I want a solid degree and a balanced experience", "I'm focused on what I'll do after graduation", "I'm still figuring out what I want"] },
      { key: 'he_p_community', q: "How important is the student community and social life to your experience?", exportLabel: "Community Importance",
        opts: ["Critically important — it's a big part of why I'm here", "Important but secondary to academics", "Somewhat important — I value a few close connections", "Not very — I prefer to focus on study and personal time"] },
      { key: 'he_p_career', q: "How would you describe your relationship with your career plans right now?", exportLabel: "Career Clarity",
        opts: ["Very clear — I have a specific path in mind", "Broadly clear — I know the direction", "Exploring — I'm using this time to figure it out", "Uncertain — and that's a source of anxiety"] },
    ],
    npsPrompt: "How likely are you to recommend this institution to a prospective student?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's really valuable to know — thank you. What's the primary thing holding you back from recommending us?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate your honesty. What aspect of your experience has been most disappointing?", clarify: false, useAI: false },
          "3": { prompt: "Thanks for that. What would need to change for you to feel enthusiastic about recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear! What one thing would turn you into a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's wonderful — thank you! What would you highlight to a prospective student?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry your experience hasn't been what you hoped. Is it academic, support services, facilities, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for telling us. What's caused the most frustration during your time here?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate your candour. What change would have the biggest positive impact for you?", clarify: false, useAI: false },
          "4": { prompt: "Really glad to hear that. What one improvement would make your experience outstanding?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant! What has made your time here particularly rewarding?", clarify: false, useAI: false }
        }
      },
  },

  hospitality: {
    greeting: "Hi -- we'd love to hear about your stay with us. Your feedback genuinely helps us improve for every guest.",
    ratingPrompt: "How would you rate your overall stay experience?",
    promoterQ1: "Wonderful! What made your stay particularly memorable?",
    passiveQ1: "Thank you for staying with us. What could we have done to make your visit even more enjoyable?",
    detractorQ1: "I'm sorry your stay didn't meet your expectations. What was the main issue you experienced?",
    q3: "Were there any specific areas -- check-in, your room, dining, or service -- you'd particularly like to comment on?",
    q4: "Is there anything else you'd like us to know before you go?",
    clarifiers: {
      default: "Could you tell me a little more about that?",
      room: "What specifically about the room are you referring to?",
      staff: "Which part of our team are you referring to, and what happened?",
      cleanliness: "Which area or item are you referring to when it comes to cleanliness?",
    },
    psychographicBank: [
      { key: 'ho_p_travel_identity', q: "How would you describe yourself as a traveller?", exportLabel: "Traveller Identity",
        opts: ["A comfort seeker — quality and ease matter most", "An explorer — I love discovering new places and cultures", "A planner — I research and optimise every trip", "A spontaneous traveller — I go with the flow"] },
      { key: 'ho_p_stay_values', q: "What matters most to you when choosing where to stay?", exportLabel: "Stay Values",
        opts: ["Location and proximity to what I'm here for", "Comfort and quality of the room", "Value for money", "Unique character or design", "Service and how the staff make me feel"] },
      { key: 'ho_p_service_style', q: "What style of service do you prefer?", exportLabel: "Service Style Preference",
        opts: ["Unobtrusive — professional but hands-off", "Warm and personal — I enjoy genuine interaction", "Efficient and seamless — fast and frictionless", "Flexible — it depends on my mood and purpose"] },
      { key: 'ho_p_loyalty', q: "What drives your hotel loyalty decisions?", exportLabel: "Loyalty Drivers",
        opts: ["Points and rewards programmes", "Consistent quality I can rely on", "The personal connections I've built", "Price and availability", "I don't have particular hotel loyalty"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or colleague for their next stay?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're very sorry to hear that. What happened that would stop you from recommending us?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for your honesty. Was it the room, the service, or the facilities that let you down?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate that feedback. What would have made your stay more recommendable?", clarify: false, useAI: false },
          "4": { prompt: "Glad you had a good stay! What one thing would make you a wholehearted advocate?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful to hear — thank you! What would you tell a friend about staying with us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're really sorry. Was it your room, check-in, dining, or another part of the experience?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for sharing that. What was the biggest disappointment during your stay?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made this a truly memorable stay?", clarify: false, useAI: false },
          "4": { prompt: "So glad your stay was enjoyable! Is there one thing we could do better next time?", clarify: false, useAI: false },
          "5": { prompt: "Delighted to hear it! What made your stay stand out?", clarify: false, useAI: false }
        }
      },
  },

  media_entertainment: {
    greeting: "Hi -- thank you for being part of our audience. We'd love to hear your thoughts on your experience with us.",
    ratingPrompt: "How would you rate your overall experience with our content or platform?",
    promoterQ1: "Love to hear that! What has been most compelling about our content for you?",
    passiveQ1: "Thank you for sharing. What would make our content or platform more valuable to you?",
    detractorQ1: "I'm sorry to hear that. What has been most disappointing about your experience?",
    q3: "Are there specific shows, articles, features, or content types you'd like to highlight or see more of?",
    q4: "Is there anything else about your experience with us you'd like to share?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      content: "Which type of content or specific show or article are you referring to?",
      platform: "Is this about the app, the website, or how content is delivered?",
      subscription: "Is this about the value you get relative to the cost?",
    },
    psychographicBank: [
      { key: 'me_p_consumption', q: "How would you describe your media and entertainment habits?", exportLabel: "Media Consumption Style",
        opts: ["A casual consumer — I dip in when I have time", "A regular — I have favourite shows, channels or genres I follow", "An enthusiast — entertainment is a significant part of my life", "A discoverer — I actively seek out new content and experiences"] },
      { key: 'me_p_discovery', q: "How do you typically discover new content or entertainment?", exportLabel: "Content Discovery",
        opts: ["Recommendations from friends or family", "Algorithm suggestions and platforms", "Critics, reviews and media coverage", "Social media trends", "I browse and discover on my own"] },
      { key: 'me_p_value', q: "What do you look for most in your entertainment experiences?", exportLabel: "Entertainment Values",
        opts: ["Escape and relaxation", "Stimulation and ideas that challenge me", "Laughter and lightness", "Emotional depth and connection", "Education and learning something new"] },
      { key: 'me_p_social', q: "Is entertainment mostly a solo or social activity for you?", exportLabel: "Entertainment Socialness",
        opts: ["Mostly solo — it's personal time", "A mix — some things I share, others are just mine", "Mostly social — I prefer experiencing things with others", "I share content a lot online"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "Sorry to hear that. What's the main thing that would make you hesitate to recommend us?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for being honest. Was it the content, the experience, or value for money that disappointed?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What would have made this something you'd recommend without hesitation?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you enjoyed it! What one thing would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's great to hear — thank you! What would you tell a friend about us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry the experience didn't land well. Was it the content, the quality, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for telling us. What was the biggest let-down for you?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one change would have made this a great experience?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you enjoyed it! What could we do to make it even better?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant! What stood out most for you?", clarify: false, useAI: false }
        }
      },
  },

  nonprofits: {
    greeting: "Hi -- thank you so much for your involvement with our organisation. Your feedback helps us serve our mission more effectively.",
    ratingPrompt: "How would you rate your overall experience with our organisation?",
    promoterQ1: "That means a lot to us! What has made your experience most meaningful?",
    passiveQ1: "Thank you for your time. What would make your experience with us even more rewarding?",
    detractorQ1: "I'm sorry to hear that. What has been the biggest challenge in your experience with us?",
    q3: "Are there specific programs, communications, or interactions you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      program: "Which specific program or initiative are you referring to?",
      communication: "Is this about how we communicate our impact, our needs, or something else?",
      volunteer: "Was this about the organisation, a specific event, or the team you worked with?",
    },
    psychographicBank: [
      { key: 'np_p_motivation', q: "What motivates your involvement with this organisation?", exportLabel: "Involvement Motivation",
        opts: ["A personal connection to the cause", "A belief in systemic change", "Wanting to give back to my community", "Professional or skills-based contribution", "Faith or values that align with the mission"] },
      { key: 'np_p_impact_view', q: "How do you feel about the impact of charitable giving and volunteering?", exportLabel: "Impact View",
        opts: ["Very optimistic — I believe individuals can make a real difference", "Broadly positive but I want evidence of impact", "Cautiously hopeful — progress is slow but necessary", "Somewhat sceptical — I question whether effort translates to change"] },
      { key: 'np_p_engagement_style', q: "How do you prefer to contribute?", exportLabel: "Contribution Style",
        opts: ["Financially — donating money", "With time — volunteering and showing up", "With skills — contributing expertise", "Advocacy — raising awareness in my network", "I engage in multiple ways"] },
      { key: 'np_p_values', q: "Which value is most central to why you engage with causes like this?", exportLabel: "Core Value",
        opts: ["Fairness and social justice", "Compassion and care for others", "Responsibility to future generations", "Community and belonging", "Faith and moral duty"] },
    ],
    npsPrompt: "How likely are you to recommend our organisation or this programme to someone you know?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's important to hear — thank you. What is the main reason you'd be reluctant to recommend us?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate your honesty. What hasn't met your expectations?", clarify: false, useAI: false },
          "3": { prompt: "Thank you for sharing that. What would need to change for you to feel confident recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Really good to hear. What one thing would make you a definite advocate for our work?", clarify: false, useAI: false },
          "5": { prompt: "That means so much — thank you. What would you tell someone considering getting involved?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry your experience didn't reflect our values. Was it communication, impact, or support that fell short?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for that candid feedback. What was the most significant issue?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate you sharing that. What change would have made the biggest positive difference?", clarify: false, useAI: false },
          "4": { prompt: "Really glad your experience was a positive one. What could we do even better?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful to hear — thank you! What has made this experience meaningful for you?", clarify: false, useAI: false }
        }
      },
  },

  performing_arts: {
    greeting: "Hi -- thank you for joining us today. We'd love to hear about your experience. Your feedback helps us create unforgettable performances for everyone.",
    ratingPrompt: "How would you rate your overall experience today?",
    promoterQ1: "Wonderful! What was the highlight of the experience for you?",
    passiveQ1: "Thank you for coming. What could we have done to make it even more memorable?",
    detractorQ1: "I'm sorry the experience didn't quite meet your expectations. What let you down?",
    q3: "Were there any specific aspects -- the performance, venue, staff, or logistics -- you'd like to comment on?",
    q4: "Is there anything else you'd like to share about today?",
    clarifiers: {
      default: "Could you tell me a little more about that?",
      venue: "Was this about the physical space, seating, facilities, or acoustics?",
      performance: "Which part of the performance are you referring to?",
      access: "Was this about ticketing, parking, entry, or navigating the venue?",
    },
    psychographicBank: [
      { key: 'pa_p_relationship', q: "How would you describe your relationship with the performing arts?", exportLabel: "Arts Relationship",
        opts: ["A casual attender — I come when something grabs me", "A regular supporter — I attend often and follow certain companies", "A passionate enthusiast — it's central to my cultural life", "A professional or practitioner — I'm connected through my work"] },
      { key: 'pa_p_discovery', q: "How do you typically choose what to see?", exportLabel: "Discovery Method",
        opts: ["Reviews and critical coverage", "Recommendations from people I trust", "I follow specific artists, companies or venues", "I browse and take chances on the unknown", "Subscription or season tickets"] },
      { key: 'pa_p_value', q: "What do you value most in a live performance experience?", exportLabel: "Performance Values",
        opts: ["Technical brilliance and craft", "Emotional impact and storytelling", "Innovation and being challenged", "The communal experience of an audience", "The unique energy of live performance"] },
      { key: 'pa_p_access', q: "What is the biggest barrier to attending more often?", exportLabel: "Attendance Barrier",
        opts: ["Price and affordability", "Time and scheduling", "Awareness — I often miss what's on", "Accessibility — getting to the venue", "Finding company to go with"] },
    ],
    npsPrompt: "How likely are you to recommend this event or venue to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. What would need to change for you to feel differently about recommending us?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for your honesty. Was it the performance, the venue, or the overall experience?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate that. What would have made this something you'd enthusiastically recommend?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you enjoyed it! What one thing would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's wonderful — thank you! What would you tell a friend about coming here?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry the experience fell short. Was it the performance, seating, acoustics, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for sharing that. What disappointed you most this evening?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one improvement would have made this a standout experience?", clarify: false, useAI: false },
          "4": { prompt: "So glad you had a good time! Is there anything we could do even better?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful! What made the evening particularly special for you?", clarify: false, useAI: false }
        }
      },
  },

  political: {
    greeting: "Hi -- thank you for taking a moment to share your views. Your voice matters and we want to make sure it's heard.",
    ratingPrompt: "How would you rate your overall impression of what you've heard or seen from us recently?",
    promoterQ1: "That's great to hear! What has resonated most with you?",
    passiveQ1: "Thank you for your time. What could we be doing better to connect with you and your community?",
    detractorQ1: "I appreciate your honesty. What has fallen short of your expectations?",
    q3: "Are there specific issues or topics you feel aren't being adequately addressed?",
    q4: "Is there anything else you'd like our team to know?",
    clarifiers: {
      default: "Could you tell me a bit more about what you mean?",
      policy: "Which specific policy area are you referring to?",
      communication: "How would you prefer to receive information and updates?",
      event: "Was there a particular moment, statement, or interaction you're referring to?",
    },
    psychographicBank: [
      { key: 'po_p_engagement', q: "How would you describe your level of political engagement?", exportLabel: "Political Engagement",
        opts: ["Very engaged — I follow politics closely and act on it", "Engaged at election time mainly", "Interested but not always active", "Disengaged — I find the system frustrating or uninspiring"] },
      { key: 'po_p_trust', q: "How much do you trust political institutions to act in the public interest?", exportLabel: "Institutional Trust",
        opts: ["A great deal", "A fair amount", "Not very much", "Not at all"] },
      { key: 'po_p_change', q: "What best describes how you believe change happens?", exportLabel: "Change Belief",
        opts: ["Through elected officials and legislation", "Through grassroots organising and activism", "Through economic pressure on businesses", "Through cultural shifts in public opinion", "Change is slow and I'm sceptical it happens at all"] },
      { key: 'po_p_values', q: "Which value is most important to you in political decisions?", exportLabel: "Political Value",
        opts: ["Individual freedom and personal responsibility", "Fairness and equality of opportunity", "Community and collective well-being", "Security and stability", "Environmental stewardship"] },
    ],
    npsPrompt: "How likely are you to recommend engaging with our campaign or organisation to someone you know?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's very helpful to know — thank you. What is the main concern that would hold you back?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate your candour. What has fallen short of your expectations?", clarify: false, useAI: false },
          "3": { prompt: "Thank you for that. What would need to change for you to feel more supportive?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear. What one thing would turn you into a strong advocate?", clarify: false, useAI: false },
          "5": { prompt: "Thank you — that means a lot. What would you say to someone considering getting involved?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry your experience hasn't been positive. What has been the biggest concern for you?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for your honesty. What aspect of your experience has disappointed you most?", clarify: false, useAI: false },
          "3": { prompt: "We appreciate that feedback. What one change would have made the biggest difference?", clarify: false, useAI: false },
          "4": { prompt: "Really glad your experience has been positive. What could we do better?", clarify: false, useAI: false },
          "5": { prompt: "That's wonderful to hear. What has made your experience stand out?", clarify: false, useAI: false }
        }
      },
  },

  retail_ecommerce: {
    greeting: "Hi -- thank you for shopping with us! We'd love to hear about your experience today.",
    ratingPrompt: "How would you rate your overall shopping experience?",
    promoterQ1: "So glad to hear that! What stood out most about your experience?",
    passiveQ1: "Thank you for sharing. What could we have done to make your shopping experience even better?",
    detractorQ1: "I'm sorry to hear that. What let you down about your experience today?",
    q3: "Was there anything about the product selection, checkout process, or service you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      product: "Which item or category are you referring to?",
      shipping: "Was this about delivery speed, packaging, or tracking?",
      return: "Was the return or exchange process unclear, inconvenient, or something else?",
    },
    psychographicBank: [
      { key: 're_p_shopping_identity', q: "How would you describe your relationship with shopping?", exportLabel: "Shopping Identity",
        opts: ["A researcher — I compare everything before buying", "A browser — I enjoy exploring and discovering", "A purposeful buyer — I come when I need something specific", "A deal-seeker — value drives all my decisions", "An impulse buyer — I go with what grabs me"] },
      { key: 're_p_values', q: "What matters most to you when making a purchase decision?", exportLabel: "Purchase Values",
        opts: ["Price and value for money", "Quality and durability", "Brand trust and reputation", "Ethical sourcing or sustainability", "Convenience and speed of delivery"] },
      { key: 're_p_loyalty', q: "What creates loyalty to a retailer for you?", exportLabel: "Retail Loyalty Drivers",
        opts: ["Consistently great products", "Fair pricing and transparent policies", "Exceptional service when things go wrong", "Rewards, points or personalised offers", "Values alignment — I shop where I feel good about it"] },
      { key: 're_p_sustainability', q: "How much does sustainability influence your purchasing?", exportLabel: "Sustainability Influence",
        opts: ["A lot — I actively seek sustainable options", "Sometimes — when it's easy or affordable", "Occasionally — I think about it but it rarely changes my choice", "Rarely — it's not a priority in my buying decisions"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. What would we need to fix before you'd feel comfortable recommending us?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for being honest. Was it the product, delivery, or customer service that let you down?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What's the main thing stopping you from recommending us right now?", clarify: false, useAI: false },
          "4": { prompt: "Great to hear! What one improvement would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's brilliant — thank you! What would you tell a friend about shopping with us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're really sorry. Was it the product itself, the delivery, or your interaction with us that went wrong?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for letting us know. What was the biggest frustration with your order or experience?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made this a great experience?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you had a positive experience! What could we do even better next time?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful to hear — thank you! What made this purchase stand out for you?", clarify: false, useAI: false }
        }
      },
  },

  saas_software: {
    greeting: "Hi -- thanks for taking a moment to share your experience with our product. Your feedback directly shapes what we build next.",
    ratingPrompt: "How would you rate your overall experience with our product?",
    promoterQ1: "That's great to hear! What has made our product most valuable to you?",
    passiveQ1: "Thank you for your feedback. What would have the biggest positive impact on your experience?",
    detractorQ1: "I'm sorry to hear that. What has been the biggest pain point or frustration?",
    q3: "Are there specific features, workflows, or parts of the product you'd like to highlight -- positively or as areas to improve?",
    q4: "Is there anything else you'd like our product team to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      feature: "Which specific feature or part of the product are you referring to?",
      performance: "Is this about speed, reliability, or something not working as expected?",
      onboarding: "Which part of the setup or getting-started process caused the difficulty?",
    },
    psychographicBank: [
      { key: 'ss_p_tech_attitude', q: "How would you describe your relationship with technology and software?", exportLabel: "Tech Attitude",
        opts: ["An early adopter — I love exploring new tools", "A pragmatist — I adopt what solves real problems", "A reluctant user — I use what I have to", "A sceptic — technology often creates as many problems as it solves"] },
      { key: 'ss_p_value_driver', q: "What is the primary value you expect from software like this?", exportLabel: "Value Driver",
        opts: ["Saving me time and removing manual work", "Giving me insights I couldn't get otherwise", "Making collaboration easier", "Reducing errors and improving reliability", "Helping me scale without adding headcount"] },
      { key: 'ss_p_change', q: "How do you feel about switching software tools when something better comes along?", exportLabel: "Switching Attitude",
        opts: ["Open to it — I'll move if the value is clearly better", "Cautious — switching is costly and disruptive", "Resistant — I prefer stability even if it means compromises", "Strategic — I evaluate every 12-24 months deliberately"] },
      { key: 'ss_p_buy_process', q: "How do you typically make decisions about software purchases?", exportLabel: "Buying Process",
        opts: ["I research heavily and evaluate alternatives", "I rely on peer and community recommendations", "I pilot first and evaluate outcomes", "I defer to my IT or procurement team", "I'm influenced by case studies and vendor expertise"] },
    ],
    npsPrompt: "How likely are you to recommend us to a colleague or peer in your industry?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "That's really important feedback — thank you. What's the primary reason you wouldn't recommend us right now?", clarify: false, useAI: false },
          "2": { prompt: "We appreciate your honesty. Is it the product, the support, or the value for money that's falling short?", clarify: false, useAI: false },
          "3": { prompt: "Thanks for that. What would need to improve for you to feel confident recommending us?", clarify: false, useAI: false },
          "4": { prompt: "Good to hear! What single improvement would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's great to hear — thank you! What would you say to a peer considering us?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. Was it reliability, usability, performance, or support that let you down?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for the candid feedback. What has been the biggest blocker or frustration?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate you sharing that. What one improvement would make the biggest positive difference to your workflow?", clarify: false, useAI: false },
          "4": { prompt: "Really glad the experience has been positive! What one thing could we improve?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant — thank you! What's made the biggest positive impact on your work?", clarify: false, useAI: false }
        }
      },
  },

  sports: {
    greeting: "Hi -- thank you for your support! We'd love to hear about your experience as a fan. This only takes a couple of minutes.",
    ratingPrompt: "How would you rate your overall experience as a fan right now?",
    promoterQ1: "Love to hear that! What has made you most proud or excited about your experience?",
    passiveQ1: "Thanks for being with us. What would make your experience as a fan even better?",
    detractorQ1: "I'm sorry to hear that. What has been most frustrating or disappointing?",
    q3: "Is there anything specific about the team, events, communication, or fan experience you'd like to highlight?",
    q4: "Is there anything else you'd like us to know?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      gameday: "Is this about the in-venue experience, ticketing, or something else on game day?",
      team: "Is this about on-field performance, management decisions, or something else?",
      communication: "Is this about social media, email, the app, or another communication channel?",
    },
    psychographicBank: [
      { key: 'sp_p_identity', q: "How central is sport to your identity?", exportLabel: "Sports Identity",
        opts: ["Central — it defines a major part of who I am", "Important — it's a big part of my social and personal life", "Recreational — I engage but it's one of many interests", "Peripheral — I'm a fan or occasional participant"] },
      { key: 'sp_p_motivation', q: "What motivates your involvement in sport?", exportLabel: "Sports Motivation",
        opts: ["Competition and achievement", "Health, fitness and physical well-being", "Community and belonging", "Entertainment and enjoyment", "Inspiration — watching or supporting elite performers"] },
      { key: 'sp_p_values', q: "What values are most important to you in sport?", exportLabel: "Sports Values",
        opts: ["Fairness and integrity", "Excellence and dedication", "Inclusivity and accessibility", "Community connection", "Athletic expression and creativity"] },
      { key: 'sp_p_fan_engagement', q: "If you're a fan, how do you prefer to engage with your team or sport?", exportLabel: "Fan Engagement",
        opts: ["Attending live events", "Watching on TV or streaming", "Following on social media and online", "Participating or playing myself", "I'm more a participant than a spectator"] },
    ],
    npsPrompt: "How likely are you to recommend this club, event, or facility to a friend or family member?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. What would need to change for you to feel differently?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for being honest. Was it the event itself, the facilities, or the overall experience?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that. What would have made this something you'd enthusiastically recommend?", clarify: false, useAI: false },
          "4": { prompt: "Great to hear! What one improvement would make you a firm advocate?", clarify: false, useAI: false },
          "5": { prompt: "That's fantastic — thank you! What would you tell a mate about coming here?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry the experience fell short. Was it the facilities, the atmosphere, the staff, or something else?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for sharing that. What was the biggest disappointment today?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made this a great day out?", clarify: false, useAI: false },
          "4": { prompt: "Really glad you had a good time! Is there anything we could do even better?", clarify: false, useAI: false },
          "5": { prompt: "Brilliant! What made today's experience stand out for you?", clarify: false, useAI: false }
        }
      },
  },

  travel_tourism: {
    greeting: "Hi -- we'd love to hear about your recent travel experience with us. Your feedback helps us make every journey better.",
    ratingPrompt: "How would you rate your overall travel experience with us?",
    promoterQ1: "Great to hear! What stood out most about your journey?",
    passiveQ1: "Thank you for travelling with us. What could we have done to improve your experience?",
    detractorQ1: "I'm sorry the journey didn't meet your expectations. What was the main issue?",
    q3: "Were there any specific touchpoints -- booking, check-in, the journey itself, or arrival -- you'd like to comment on?",
    q4: "Is there anything else about your travel experience you'd like to share?",
    clarifiers: {
      default: "Could you tell me a bit more about that?",
      delay: "How long was the delay and how were you informed about it?",
      staff: "At which stage of your journey did this happen?",
      booking: "Was this a problem with the booking process itself, or something that came up later?",
    },
    psychographicBank: [
      { key: 'tt_p_travel_identity', q: "How would you describe yourself as a traveller?", exportLabel: "Traveller Identity",
        opts: ["An adventurer — I seek the unfamiliar and off-the-beaten-path", "A culture-seeker — history, food and local life drive my trips", "A relaxer — I travel to unwind and recharge", "A planner — I research and organise every detail", "A spontaneous traveller — I love not knowing what's next"] },
      { key: 'tt_p_values', q: "What matters most to you in a travel experience?", exportLabel: "Travel Values",
        opts: ["Authentic local experiences", "Comfort and quality accommodation", "Value for money", "Safety and reliability", "Sustainable and responsible travel"] },
      { key: 'tt_p_inspiration', q: "What most inspires your travel decisions?", exportLabel: "Travel Inspiration",
        opts: ["Friends and family recommendations", "Social media and content creators", "Travel writing and editorial coverage", "A specific interest or passion (food, nature, architecture)", "Deals and opportunity"] },
      { key: 'tt_p_frequency', q: "How important is travel to your lifestyle?", exportLabel: "Travel Lifestyle",
        opts: ["Essential — I travel multiple times a year", "Very important — 1-2 significant trips a year", "Occasional — when time and budget allow", "Aspirational — I want to travel more than I currently do"] },
    ],
    npsPrompt: "How likely are you to recommend us to a friend or family member planning a trip?",
    npsFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're sorry to hear that. What went wrong that would stop you from recommending us?", clarify: false, useAI: false },
          "2": { prompt: "Thanks for your honesty. Was it the booking process, the experience itself, or value for money?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate that feedback. What would have made this something you'd recommend without hesitation?", clarify: false, useAI: false },
          "4": { prompt: "Really glad it was a good experience! What one thing would make you a definite advocate?", clarify: false, useAI: false },
          "5": { prompt: "Wonderful to hear — thank you! What would you tell a friend who was planning a similar trip?", clarify: false, useAI: false }
        }
      },
    experienceFollowUp: {
        enabled: true,
        mode: 'per-response',
        sharedPrompt: '',
        shareClarify: false,
        shareAI: false,
        perResponse: {
          "1": { prompt: "We're really sorry your trip didn't go as hoped. Was it the accommodation, transport, activities, or service?", clarify: false, useAI: false },
          "2": { prompt: "Thank you for sharing that. What was the biggest disappointment on your trip?", clarify: false, useAI: false },
          "3": { prompt: "Appreciate the feedback. What one thing would have made this a memorable experience in a positive way?", clarify: false, useAI: false },
          "4": { prompt: "So glad you had a good trip! Is there one thing we could do better next time?", clarify: false, useAI: false },
          "5": { prompt: "Fantastic! What made this trip particularly special for you?", clarify: false, useAI: false }
        }
      },
  },
}


// ── Industry-specific contextual questions (for Custom Questions page) ──────
// These are experience/segmentation questions — shown as suggestions in StepQuestions
export const INDUSTRY_SUGGESTED_QUESTIONS: Partial<Record<Exclude<Industry,"other">, import('./types').PsychoQuestion[]>> = {
  automotive_repair: [{ key: 'ar_vehicle_type', q: "What type of vehicle do you drive?", exportLabel: "Vehicle Type",
        opts: ["Sedan or coupe", "SUV or crossover", "Truck or van", "Luxury vehicle", "Electric or hybrid", "Commercial vehicle"] },
      { key: 'ar_service_type', q: "What brought you in today?", exportLabel: "Service Type",
        opts: ["Routine maintenance", "Brake service", "Engine or mechanical repair", "Electrical issue", "Body or collision work", "Inspection or diagnostic"] },
      { key: 'ar_customer_tenure', q: "How long have you been a customer here?", exportLabel: "Customer Tenure",
        opts: ["First time", "Less than a year", "1-3 years", "3-5 years", "More than 5 years"] },
      { key: 'ar_find_us', q: "How did you find us?", exportLabel: "Discovery Channel",
        opts: ["Google search", "Recommendation from friend or family", "Online review site", "Returning customer", "Drove past or saw signage"] },
      { key: 'ar_service_frequency', q: "How often do you have your vehicle serviced?", exportLabel: "Service Frequency",
        opts: ["More than once a year", "Once a year", "Every 2-3 years", "Only when something goes wrong"] },
  ],
  casual_dining: [{ key: 'cd_visit_occasion', q: "What brought you in today?", exportLabel: "Visit Occasion",
        opts: ["Casual meal out", "Family dinner", "Lunch break", "Special occasion", "First time trying us"] },
      { key: 'cd_party_size', q: "How large was your group today?", exportLabel: "Party Size",
        opts: ["Just me", "2 people", "3-4 people", "5 or more"] },
      { key: 'cd_visit_frequency', q: "How often do you dine with us?", exportLabel: "Visit Frequency",
        opts: ["First time", "Occasionally", "A few times a month", "Weekly or more"] },
      { key: 'cd_meal_period', q: "Which meal period was your visit?", exportLabel: "Meal Period",
        opts: ["Breakfast", "Brunch", "Lunch", "Dinner", "Late night"] },
      { key: 'cd_discovery', q: "How did you hear about us?", exportLabel: "Discovery Channel",
        opts: ["Word of mouth", "Social media", "Google search", "Walked past", "Returning regular"] },
  ],
  education: [{ key: 'ed_role', q: "What is your relationship to our school?", exportLabel: "Role",
        opts: ["Student", "Parent or guardian", "Teacher or staff", "Administrator", "Community member"] },
      { key: 'ed_grade_level', q: "What grade level are you associated with?", exportLabel: "Grade Level",
        opts: ["Elementary (K-5)", "Middle school (6-8)", "High school (9-12)", "Multiple grades"] },
      { key: 'ed_involvement', q: "How involved are you in school activities?", exportLabel: "Involvement Level",
        opts: ["Very involved", "Somewhat involved", "Occasionally involved", "Not very involved"] },
      { key: 'ed_primary_concern', q: "What area matters most to you right now?", exportLabel: "Primary Concern",
        opts: ["Academic performance", "Student wellbeing", "Safety and security", "Communication", "Extracurricular programs"] },
      { key: 'ed_comms_pref', q: "How do you prefer to receive school updates?", exportLabel: "Comms Preference",
        opts: ["Email", "School app or portal", "Text message", "Social media", "In-person meetings"] },
  ],
  fast_food: [{ key: 'ff_order_method', q: "How did you place your order today?", exportLabel: "Order Method",
        opts: ["Dine-in counter", "Drive-through", "Mobile app pickup", "Third-party delivery", "Curbside pickup"] },
      { key: 'ff_visit_time', q: "What time of day was your visit?", exportLabel: "Visit Time",
        opts: ["Breakfast (before 11am)", "Lunch (11am-2pm)", "Afternoon snack", "Dinner (after 5pm)", "Late night"] },
      { key: 'ff_visit_frequency', q: "How often do you visit us?", exportLabel: "Visit Frequency",
        opts: ["Daily or almost daily", "Several times a week", "Once a week", "A few times a month", "Rarely"] },
      { key: 'ff_reason', q: "Why did you choose us today?", exportLabel: "Reason for Choosing",
        opts: ["Convenience or location", "Speed", "Price", "Favourite menu item", "Habit"] },
      { key: 'ff_party_size', q: "How many people did you order for?", exportLabel: "Party Size",
        opts: ["Just me", "2 people", "3-4 people", "5 or more"] },
  ],
  financial_services: [{ key: 'fs_service_type', q: "What type of service are you primarily giving feedback about?", exportLabel: "Service Type",
        opts: ["Personal banking", "Business banking", "Mortgage or home loan", "Investments or retirement", "Insurance", "Credit card"] },
      { key: 'fs_customer_tenure', q: "How long have you been our customer?", exportLabel: "Customer Tenure",
        opts: ["Less than a year", "1-3 years", "3-7 years", "More than 7 years"] },
      { key: 'fs_primary_channel', q: "How do you primarily manage your account?", exportLabel: "Primary Channel",
        opts: ["Mobile app", "Online banking", "Branch in person", "Phone", "Mix of all"] },
      { key: 'fs_primary_concern', q: "What is your top financial concern right now?", exportLabel: "Financial Concern",
        opts: ["Building savings", "Managing debt", "Retirement planning", "Buying a home", "Growing investments", "Business finances"] },
      { key: 'fs_trust_driver', q: "What matters most when choosing a financial institution?", exportLabel: "Trust Driver",
        opts: ["Security and safety", "Low fees", "Interest rates", "Customer service", "Convenience", "Digital tools"] },
  ],
  fine_dining: [{ key: 'fd_occasion', q: "What is the occasion for your visit tonight?", exportLabel: "Visit Occasion",
        opts: ["Anniversary or birthday", "Date night", "Business dinner", "Celebration", "Treating yourself", "First time visiting"] },
      { key: 'fd_party_size', q: "How large was your dining party?", exportLabel: "Party Size",
        opts: ["2 people", "3-4 people", "5-6 people", "7 or more"] },
      { key: 'fd_discovery', q: "How did you hear about us?", exportLabel: "Discovery Channel",
        opts: ["Word of mouth", "Online reviews", "Food publication or press", "Social media", "Returning guest"] },
      { key: 'fd_dining_frequency', q: "How often do you dine at fine dining restaurants?", exportLabel: "Fine Dining Frequency",
        opts: ["Rarely (special occasions only)", "A few times a year", "Monthly", "Regularly"] },
      { key: 'fd_importance', q: "What matters most in a fine dining experience?", exportLabel: "Key Priority",
        opts: ["Quality and creativity of the food", "Service and attentiveness", "Wine and beverage program", "Atmosphere and ambiance", "Exclusivity and prestige"] },
  ],
  hr_employee: [{ key: 'hr_department', q: "Which department are you in?", exportLabel: "Department",
        opts: ["Operations", "Sales or Marketing", "Technology or IT", "Finance", "HR or People", "Customer Success", "Executive or Leadership", "Other"] },
      { key: 'hr_tenure', q: "How long have you been with the company?", exportLabel: "Tenure",
        opts: ["Less than a year", "1-2 years", "3-5 years", "6-10 years", "More than 10 years"] },
      { key: 'hr_role_level', q: "How would you describe your role?", exportLabel: "Role Level",
        opts: ["Individual contributor", "Team lead or supervisor", "Manager", "Senior manager or director", "VP or above"] },
      { key: 'hr_work_arrangement', q: "What is your primary work arrangement?", exportLabel: "Work Arrangement",
        opts: ["Fully remote", "Hybrid (some in-office)", "Fully in-office"] },
      { key: 'hr_feedback_area', q: "Which area would you most like to see improved?", exportLabel: "Improvement Area",
        opts: ["Compensation and benefits", "Work-life balance", "Career development", "Management and leadership", "Culture and belonging", "Tools and processes"] },
  ],
  healthcare: [{ key: 'hc_patient_type', q: "Which best describes your visit today?", exportLabel: "Patient Type",
        opts: ["New patient", "Returning patient", "Emergency or urgent care", "Follow-up appointment", "Procedure or surgery"] },
      { key: 'hc_visit_frequency', q: "How often do you visit our facility?", exportLabel: "Visit Frequency",
        opts: ["First time", "A few times a year", "Monthly", "Weekly or more", "As needed"] },
      { key: 'hc_primary_concern', q: "What was the primary reason for your visit?", exportLabel: "Primary Concern",
        opts: ["Routine check-up", "Illness or injury", "Chronic condition management", "Mental health", "Specialist referral"] },
      { key: 'hc_insurance_type', q: "How is your care typically covered?", exportLabel: "Insurance Type",
        opts: ["Private insurance", "Medicare or Medicaid", "Self-pay", "Workers compensation", "Prefer not to say"] },
      { key: 'hc_age_range', q: "Which age group do you fall into?", exportLabel: "Age Range",
        opts: ["18-34", "35-49", "50-64", "65 or over", "Prefer not to say"] },
  ],
  higher_education: [{ key: 'he_role', q: "What is your primary role?", exportLabel: "Role",
        opts: ["Undergraduate student", "Graduate or doctoral student", "Faculty", "Staff or administrator", "Alumni", "Parent or guardian"] },
      { key: 'he_year', q: "If you are a student, what year are you?", exportLabel: "Year or Level",
        opts: ["First year", "Sophomore", "Junior", "Senior", "Graduate", "Not currently enrolled"] },
      { key: 'he_enrollment_type', q: "What is your enrollment or engagement status?", exportLabel: "Enrollment Type",
        opts: ["Full-time on campus", "Part-time", "Online or distance", "Hybrid", "Not currently enrolled"] },
      { key: 'he_affiliation_length', q: "How long have you been affiliated with the institution?", exportLabel: "Affiliation Length",
        opts: ["Less than a year", "1-2 years", "3-4 years", "5 or more years", "Alumni (graduated)"] },
      { key: 'he_primary_concern', q: "What matters most to you right now?", exportLabel: "Primary Concern",
        opts: ["Academic quality and rigor", "Career preparation and placement", "Campus life and community", "Cost and financial aid", "Research opportunities", "Administrative services"] },
  ],
  hospitality: [{ key: 'ho_travel_purpose', q: "What was the primary purpose of your stay?", exportLabel: "Travel Purpose",
        opts: ["Leisure or vacation", "Business", "Conference or event", "Special occasion", "Passing through"] },
      { key: 'ho_party_type', q: "Who did you travel with?", exportLabel: "Travel Party",
        opts: ["Alone", "Couple", "Family with children", "Group of friends", "Business colleagues"] },
      { key: 'ho_stay_frequency', q: "How often do you stay at properties like ours?", exportLabel: "Stay Frequency",
        opts: ["First time here", "Once a year", "A few times a year", "Monthly or more"] },
      { key: 'ho_booking_channel', q: "How did you book your stay?", exportLabel: "Booking Channel",
        opts: ["Direct hotel website", "Booking.com or Expedia", "Travel agent", "Corporate booking", "Loyalty programme"] },
      { key: 'ho_room_type', q: "What type of room did you stay in?", exportLabel: "Room Type",
        opts: ["Standard or queen", "King", "Suite", "Accessible room", "Other"] },
  ],
  media_entertainment: [{ key: 'me_content_type', q: "What type of content do you primarily consume with us?", exportLabel: "Content Type",
        opts: ["News and journalism", "Music and podcasts", "Streaming TV or film", "Live sports", "Gaming", "Social media content"] },
      { key: 'me_frequency', q: "How often do you engage with our content?", exportLabel: "Engagement Frequency",
        opts: ["Daily", "Several times a week", "Weekly", "A few times a month", "Occasionally"] },
      { key: 'me_primary_device', q: "What device do you mainly use?", exportLabel: "Primary Device",
        opts: ["Smartphone", "Smart TV", "Laptop or desktop", "Tablet", "Multiple devices equally"] },
      { key: 'me_subscription', q: "What is your subscription status?", exportLabel: "Subscription Status",
        opts: ["Paid subscriber", "Free tier user", "Trial user", "Lapsed subscriber considering return"] },
      { key: 'me_discovery', q: "How do you typically discover new content?", exportLabel: "Discovery Method",
        opts: ["Algorithm recommendations", "Social media", "Word of mouth", "Editorial picks", "Browsing myself"] },
  ],
  nonprofits: [{ key: 'np_relationship', q: "How are you involved with our organisation?", exportLabel: "Relationship Type",
        opts: ["Financial donor", "Regular volunteer", "Program participant or beneficiary", "Board or committee member", "Partner organisation", "New supporter"] },
      { key: 'np_duration', q: "How long have you been connected to us?", exportLabel: "Involvement Duration",
        opts: ["Less than a year", "1-3 years", "3-5 years", "More than 5 years"] },
      { key: 'np_discovery', q: "How did you first learn about us?", exportLabel: "Discovery Channel",
        opts: ["Friend or family recommendation", "Social media", "Internet search", "Community event", "News coverage"] },
      { key: 'np_motivation', q: "What primarily motivates your involvement?", exportLabel: "Motivation",
        opts: ["Belief in the mission", "Personal connection to the cause", "Community impact", "Skills-based contribution", "Recognition", "Other"] },
      { key: 'np_engagement_pref', q: "How do you prefer to stay engaged?", exportLabel: "Engagement Preference",
        opts: ["Email updates", "Social media", "In-person events", "Volunteer opportunities", "Annual impact report"] },
  ],
  performing_arts: [{ key: 'pa_performance_type', q: "What type of performance brought you here today?", exportLabel: "Performance Type",
        opts: ["Orchestra or classical music", "Theater or drama", "Ballet or dance", "Opera", "Musical theater", "Comedy or spoken word", "Contemporary or experimental"] },
      { key: 'pa_ticket_acquisition', q: "How did you get your tickets?", exportLabel: "Ticket Acquisition",
        opts: ["Online in advance", "Box office on the day", "Season ticket or subscription", "Gift", "Complimentary or guest list"] },
      { key: 'pa_frequency', q: "How often do you attend live performances?", exportLabel: "Attendance Frequency",
        opts: ["This is my first time", "Once or twice a year", "A few times a year", "Monthly or more"] },
      { key: 'pa_distance', q: "How far did you travel to attend?", exportLabel: "Travel Distance",
        opts: ["Under 15 minutes", "15-30 minutes", "30-60 minutes", "Over an hour", "Travelled from out of town"] },
      { key: 'pa_group', q: "Who did you come with today?", exportLabel: "Group Composition",
        opts: ["Alone", "Partner or spouse", "Friends", "Family with children", "Adult family members"] },
  ],
  political: [{ key: 'po_voter_status', q: "Are you a registered voter in this area?", exportLabel: "Voter Status",
        opts: ["Yes, registered here", "Yes, registered elsewhere", "Not currently registered", "Prefer not to say"] },
      { key: 'po_engagement_level', q: "How engaged are you in local or national politics?", exportLabel: "Engagement Level",
        opts: ["Very engaged -- I follow closely", "Somewhat engaged", "Occasionally interested", "Not usually engaged"] },
      { key: 'po_top_issue', q: "Which issue matters most to you right now?", exportLabel: "Top Issue",
        opts: ["Economy and jobs", "Healthcare", "Education", "Public safety", "Climate and environment", "Immigration", "Other"] },
      { key: 'po_political_lean', q: "How would you describe your political leaning?", exportLabel: "Political Leaning",
        opts: ["Progressive or left", "Centre-left", "Centrist", "Centre-right", "Conservative or right", "Prefer not to say"] },
      { key: 'po_local_area', q: "Which area do you primarily identify with?", exportLabel: "Geographic Area",
        opts: ["Urban", "Suburban", "Rural", "Small town", "Prefer not to say"] },
  ],
  retail_ecommerce: [{ key: 're_shopping_channel', q: "How do you primarily shop with us?", exportLabel: "Shopping Channel",
        opts: ["In-store only", "Online only", "Both in-store and online", "Mobile app"] },
      { key: 're_purchase_frequency', q: "How often do you purchase from us?", exportLabel: "Purchase Frequency",
        opts: ["First time", "Rarely", "A few times a year", "Monthly", "Weekly or more"] },
      { key: 're_product_category', q: "What do you most often purchase?", exportLabel: "Product Category",
        opts: ["Clothing and apparel", "Electronics", "Home and garden", "Health and beauty", "Food and grocery", "Other"] },
      { key: 're_discovery', q: "How did you find us or this product today?", exportLabel: "Discovery Channel",
        opts: ["Search engine", "Social media", "Friend recommendation", "Email promotion", "Already a regular customer"] },
      { key: 're_loyalty', q: "Are you a member of our rewards or loyalty program?", exportLabel: "Loyalty Status",
        opts: ["Yes, active member", "Yes but I rarely use it", "No but I am interested", "No, not interested"] },
  ],
  saas_software: [{ key: 'ss_role', q: "What best describes your role?", exportLabel: "Role",
        opts: ["Individual end user", "Team lead or manager", "IT administrator", "Business owner", "Developer or engineer", "Executive"] },
      { key: 'ss_company_size', q: "How large is your organisation?", exportLabel: "Company Size",
        opts: ["Just me (freelancer)", "2-10 people", "11-50 people", "51-250 people", "251-1000 people", "Over 1000 people"] },
      { key: 'ss_usage_tenure', q: "How long have you been using our product?", exportLabel: "Usage Tenure",
        opts: ["Less than a month", "1-6 months", "6-12 months", "1-2 years", "More than 2 years"] },
      { key: 'ss_primary_use_case', q: "What is your primary use case?", exportLabel: "Primary Use Case",
        opts: ["Project management", "Communication or collaboration", "Analytics or reporting", "Customer management", "Development or DevOps", "Finance or operations"] },
      { key: 'ss_technical_comfort', q: "How would you rate your technical proficiency?", exportLabel: "Technical Proficiency",
        opts: ["Non-technical -- I need things simple", "Moderately technical", "Technical -- comfortable with advanced features"] },
  ],
  sports: [{ key: 'sp_fan_level', q: "How would you describe your level of fandom?", exportLabel: "Fan Level",
        opts: ["Casual fan", "Regular follower", "Dedicated fan", "Die-hard or superfan"] },
      { key: 'sp_follow_method', q: "How do you primarily follow the team or sport?", exportLabel: "Follow Method",
        opts: ["Attending games in person", "Watching on TV or cable", "Streaming online", "Following on social media", "Reading news or podcasts"] },
      { key: 'sp_season_ticket', q: "Are you a season ticket holder or member?", exportLabel: "Season Ticket Status",
        opts: ["Yes, current season ticket holder", "Yes, I have a membership", "Previously was, not currently", "No but considering it", "No"] },
      { key: 'sp_tenure', q: "How long have you been a fan?", exportLabel: "Fan Tenure",
        opts: ["Less than a year", "1-3 years", "3-10 years", "More than 10 years", "My whole life"] },
      { key: 'sp_game_attendance', q: "How often do you attend games or events in person?", exportLabel: "Game Attendance",
        opts: ["Every game or most games", "Several times a season", "Once or twice a season", "Rarely or never"] },
  ],
  travel_tourism: [{ key: 'tt_trip_purpose', q: "What was the purpose of your trip?", exportLabel: "Trip Purpose",
        opts: ["Leisure or holiday", "Business travel", "Visiting family or friends", "Honeymoon or special occasion", "Group or packaged tour"] },
      { key: 'tt_travel_frequency', q: "How often do you travel?", exportLabel: "Travel Frequency",
        opts: ["Rarely (once a year or less)", "A few times a year", "Monthly", "Weekly or more"] },
      { key: 'tt_booking_method', q: "How did you book your travel?", exportLabel: "Booking Method",
        opts: ["Direct with the provider", "OTA (Expedia, Kayak etc.)", "Travel agent", "Corporate travel desk", "Loyalty app"] },
      { key: 'tt_party_type', q: "Who did you travel with?", exportLabel: "Travel Party",
        opts: ["Solo", "Couple", "Family with children", "Group of friends", "Business colleagues"] },
      { key: 'tt_destination_type', q: "Which best describes your destination?", exportLabel: "Destination Type",
        opts: ["Domestic city break", "Domestic longer trip", "International short-haul", "International long-haul", "Cruise or expedition"] },
  ],
}
