// lib/coalitionStudyTemplate.ts
// Coalition for the Homeless — Donor Study Configuration
// Complete study template ready to deploy
// Created from stakeholder questions mapping: Brad Butterstein (CEO), Craig Fairey (Wells Fargo),
// Liza Coburn (TRUIST), Jim Schreiber (Attorney), Sean McGrady, Larry Kahn

import { StudyConfig } from '@/lib/types'

// Simple ID generator for survey questions
const generateId = (function() {
  let counter = 0
  return function() { return 'q_' + (++counter) }
})()

/**
 * COALITION FOR THE HOMELESS — DONOR INSIGHT STUDY
 *
 * Survey Structure:
 * - 31 total questions
 * - 21 categorical/likert (multiple choice, scales, multi-select)
 * - 8 open-ended (capture nuance + strategic insights)
 * - 2 demographic (involvement, tenure)
 *
 * Completion time: ~10-14 minutes (use customQCount to sample a subset per respondent)
 * Focus: Donor motivation, retention, growth, capital campaign, & legacy giving
 */

export const coalitionDonorStudyConfig: StudyConfig = {
  // ──────────────────────────────────────────────────────────
  // GREETING & CORE SETTINGS
  // ──────────────────────────────────────────────────────────
  greeting: "Hi! Thank you for supporting the Coalition for the Homeless. Your feedback helps us serve our mission more effectively and engage donors in ways that matter most to you.",

  industry: 'nonprofit',

  // ──────────────────────────────────────────────────────────
  // NPS (disabled for this donor study — using experience rating instead)
  // ──────────────────────────────────────────────────────────
  npsEnabled: false,
  experienceEnabled: true,
  ratingPrompt: "How would you rate your overall experience with the Coalition?",
  ratingScale: [
    { score: 1, label: "Very Unsatisfied", emoji: "😞" },
    { score: 2, label: "Unsatisfied", emoji: "😕" },
    { score: 3, label: "Neutral", emoji: "😐" },
    { score: 4, label: "Satisfied", emoji: "🙂" },
    { score: 5, label: "Very Satisfied", emoji: "😄" },
  ],
  experienceRatingLabel: "Overall Experience",

  // ──────────────────────────────────────────────────────────
  // LEGACY OPEN-ENDED Q3/Q4 (disabled — using new custom questions)
  // ──────────────────────────────────────────────────────────
  q3: "Any final thoughts?",
  q3Enabled: false,
  q4: "",
  q4Enabled: false,

  // ──────────────────────────────────────────────────────────
  // CUSTOM QUESTIONS (29 total)
  // Organized in 8 sections:
  // 1. Awareness & Perception (3Q) — Sean McGrady
  // 2. Giving Profile & Mindset (3Q)
  // 3. Motivation & Values (4Q) — enhanced with Sean McGrady
  // 4. Communication & Recognition (3Q)
  // 5. Engagement & Involvement (3Q) — enhanced with Sean McGrady
  // 6. Retention & Growth (2Q)
  // 7. Legacy, Capital Campaign & Strategic Giving (5Q) — enhanced with Sean McGrady
  // + 6 Open-Ended Insights
  // ──────────────────────────────────────────────────────────

  questions: [
    // ─── SECTION 1: AWARENESS & PERCEPTION (3Q) — Sean McGrady ───
    {
      id: generateId(),
      type: 'radio',
      prompt: "How familiar are you with the Coalition's programs and impact in Central Florida?",
      exportLabel: "Org Familiarity",
      required: true,
      options: [
        "Very familiar — I follow closely and understand the programs well",
        "Somewhat familiar — I know the basics but not the details",
        "Slightly familiar — I've heard of the Coalition but know little about its work",
        "Not familiar — this is relatively new to me",
      ],
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "What is your current understanding of homelessness in our community, and where do you see the greatest unmet need?",
      exportLabel: "Perceived Unmet Need",
      required: false,
      clarify: true,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "Which area do you believe represents the greatest unmet need in addressing homelessness locally?",
      exportLabel: "Greatest Unmet Need",
      required: true,
      options: [
        "Affordable housing and permanent supportive housing",
        "Mental health and substance abuse treatment",
        "Job training and employment pathways",
        "Emergency shelter and basic needs (food, hygiene)",
        "Prevention — keeping at-risk families housed",
        "Services for specific populations (veterans, youth, families)",
        "Systemic advocacy and policy change",
        "Unsure / need more information",
      ],
    },

    // ─── SECTION 2: GIVING PROFILE & MINDSET (3Q) ───
    {
      id: generateId(),
      type: 'radio',
      prompt: "Do you feel homelessness presents a critical problem in Central Florida?",
      exportLabel: "Problem Perception",
      required: true,
      options: [
        "Critical problem requiring urgent action",
        "Serious issue that needs attention",
        "Moderate concern worth addressing",
        "Minor concern",
        "Not a priority",
        "Unsure",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "Who do you believe should primarily be responsible for solving homelessness in our community?",
      exportLabel: "Responsibility View",
      required: true,
      options: [
        "Government (federal, state, local)",
        "For-profit corporations",
        "Nonprofit organizations",
        "Individual citizens and families",
        "All should contribute equally",
        "Other",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "How do you typically approach charitable donations?",
      exportLabel: "Giving Pattern",
      required: true,
      options: [
        "Structured/planned giving (regular monthly or annual commitments)",
        "Discretionary (give only when I have extra funds)",
        "Both — mix of planned and spontaneous",
        "Event or campaign-based (respond to specific appeals)",
        "Other approach",
      ],
    },

    {
      id: generateId(),
      type: 'checkbox',
      prompt: "When you evaluate philanthropic opportunities, what criteria matter most in deciding where to invest? (Select all that apply)",
      exportLabel: "Giving Criteria",
      required: true,
      options: [
        "Measurable outcomes and proven impact",
        "Strong leadership and governance",
        "Financial transparency and efficiency",
        "Alignment with my personal values and passions",
        "Local community focus",
        "Innovation and forward-thinking approach",
        "Recommendation from peers or trusted advisors",
        "Personal connection to the cause or beneficiaries",
        "Ability to see or experience the impact firsthand",
      ],
    },

    // ─── SECTION 3: MOTIVATION & VALUES (4Q) — enhanced with Sean McGrady ───
    {
      id: generateId(),
      type: 'open',
      prompt: "What experiences or values most influence your interest in addressing homelessness?",
      exportLabel: "Personal Motivation",
      required: false,
      clarify: true,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "What is the primary reason you donate to organizations like the Coalition?",
      exportLabel: "Why You Give",
      required: true,
      options: [
        "Personal connection to the mission or someone affected",
        "Request or recommendation from a friend, colleague, or associate",
        "Specific campaign or cause that resonated with me",
        "Strong reputation and trust in the organization",
        "Evidence of impact and measurable results",
        "Tax benefit / financial incentive",
        "Other",
      ],
    },
    {
      id: generateId(),
      type: 'likert',
      prompt: "How important is evidence of impact tied to specific programs or individuals when deciding to give or increase your donation?",
      exportLabel: "Impact Importance",
      required: true,
      likertScale: [
        { score: 1, label: "Not important — I trust the organization" },
        { score: 2, label: "Somewhat important — nice to have but not required" },
        { score: 3, label: "Moderately important — influences but isn't deciding factor" },
        { score: 4, label: "Very important — high influence on my decision" },
        { score: 5, label: "Extremely important — I need proof of impact" },
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "Which best describes your giving capacity and interest in the Coalition?",
      exportLabel: "Donor Capacity",
      required: true,
      options: [
        "Modest donor — small annual gifts when able",
        "Moderate donor — regular planned giving ($500–$5k/year)",
        "Major donor — significant annual support ($5k–$50k/year)",
        "Transformational donor — substantial/transformative gifts (>$50k)",
        "Prefer not to say",
      ],
    },

    // ─── SECTION 4: COMMUNICATION & RECOGNITION (3Q) ───
    {
      id: generateId(),
      type: 'checkbox',
      prompt: "What is your preferred method for receiving updates from the Coalition? (Select all that apply)",
      exportLabel: "Communication Methods",
      required: true,
      options: [
        "Email updates / newsletters",
        "Text message alerts",
        "Social media (Facebook, LinkedIn, etc.)",
        "Physical newsletter or annual report",
        "Phone call from leadership",
        "In-person meeting or event",
        "I prefer minimal contact",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "How often would you like to hear from the Coalition?",
      exportLabel: "Communication Frequency",
      required: true,
      options: [
        "Monthly or more frequently",
        "Quarterly (4x per year)",
        "Semi-annually (2x per year)",
        "Annually (once per year)",
        "As-needed only (major milestones)",
        "Prefer not to receive updates",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "When you give to an organization, what form of recognition matters most to you?",
      exportLabel: "Recognition Preference",
      required: true,
      options: [
        "Hand-written thank you note from leadership",
        "Personal phone call from a Board member or executive",
        "Email receipt and formal acknowledgement",
        "Public recognition (website, newsletter, event mention)",
        "Tax receipt only — no additional recognition needed",
        "Other",
      ],
    },

    // ─── SECTION 5: ENGAGEMENT & INVOLVEMENT (3Q) — enhanced with Sean McGrady ───
    {
      id: generateId(),
      type: 'radio',
      prompt: "Are you interested in volunteering for the Coalition in addition to your financial support?",
      exportLabel: "Volunteer Interest",
      required: true,
      options: [
        "Yes — definitely interested",
        "Yes — possibly, tell me more",
        "Prefer to support financially, not volunteer",
        "No — not interested in volunteering",
        "Already volunteer",
      ],
    },
    {
      id: generateId(),
      type: 'checkbox',
      prompt: "Beyond financial contributions, in what ways do you prefer to engage? (Select all that apply)",
      exportLabel: "Engagement Beyond Financial",
      required: true,
      options: [
        "Advisory or board roles",
        "Advocacy and raising awareness",
        "Convening others — connecting people and resources",
        "Hands-on volunteering with clients",
        "Event hosting or sponsorship",
        "Mentoring or professional skills sharing",
        "Prefer financial support only",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "Which aspect of the Coalition's work is MOST compelling to you?",
      exportLabel: "Compelling Programs",
      required: true,
      options: [
        "Direct client services (shelter, meals, healthcare)",
        "Job training and workforce development",
        "Mental health and substance abuse services",
        "Housing and permanent supportive housing",
        "Advocacy and policy change",
        "Serving vulnerable populations (youth, families, veterans)",
        "Geographic focus on Central Florida",
        "Other aspect",
      ],
    },

    // ─── SECTION 6: RETENTION & GROWTH (2Q) ───
    {
      id: generateId(),
      type: 'checkbox',
      prompt: "What would cause you to stop donating to the Coalition? (Select all that apply)",
      exportLabel: "Churn Reasons",
      required: true,
      options: [
        "Loss of trust in leadership or mission",
        "Lack of evidence showing impact or results",
        "Poor communication or feeling ignored as donor",
        "Personal financial difficulty",
        "Disagreement with organizational direction or decisions",
        "Finding a better opportunity or more impactful organization",
        "Organization no longer needed or mission accomplished",
        "Organization changes direction away from my values",
        "Nothing — I'm committed long-term",
        "Other",
      ],
    },
    {
      id: generateId(),
      type: 'checkbox',
      prompt: "What would motivate you to increase your monthly, quarterly, or yearly donation? (Select all that apply)",
      exportLabel: "Growth Triggers",
      required: true,
      options: [
        "Launch of a new, compelling program",
        "Documented evidence of measurable impact",
        "Personal request from CEO or Board member",
        "Matching gift or challenge grant opportunity",
        "Major milestone or facility expansion (e.g., new building)",
        "Volunteer experience with the Coalition first",
        "Seeing a specific unmet need I can help address",
        "Nothing more — current level is right for me",
        "Other",
      ],
    },

    // ─── SECTION 7: LEGACY, CAPITAL CAMPAIGN & STRATEGIC GIVING (5Q) — enhanced with Sean McGrady ───
    {
      id: generateId(),
      type: 'radio',
      prompt: "If you have a will or plan to make one, would you consider a bequest to the Coalition?",
      exportLabel: "Bequest Interest",
      required: true,
      options: [
        "Yes — very interested, tell me more",
        "Possibly — open to discussion",
        "Already included in my will",
        "No — prefer other giving methods",
        "Unsure / haven't thought about it",
        "Prefer not to say",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "Which type of giving is most attractive to you?",
      exportLabel: "Preferred Giving Vehicle",
      required: true,
      options: [
        "Current operating budget (keep programs running now)",
        "Endowed foundation fund (long-term financial stability)",
        "Specific program fund (e.g., Job Training, Housing)",
        "Building or facility campaign (e.g., new shelter)",
        "Planned gift / bequest fund",
        "Matching fund or grant (leverage my gift)",
        "Other",
      ],
    },

    {
      id: generateId(),
      type: 'radio',
      prompt: "How do you typically prioritize between immediate-impact programs and long-term infrastructure investments like capital campaigns?",
      exportLabel: "Immediate vs Long-Term Priority",
      required: true,
      options: [
        "Strongly prefer immediate impact — help people right now",
        "Lean toward immediate impact, but open to infrastructure",
        "Balance both — split support between immediate and long-term",
        "Lean toward infrastructure — lasting systemic change matters more",
        "Strongly prefer long-term infrastructure investments",
        "It depends on the opportunity and timing",
      ],
    },
    {
      id: generateId(),
      type: 'radio',
      prompt: "How do you typically structure your philanthropic commitments?",
      exportLabel: "Commitment Structure",
      required: true,
      options: [
        "One-time gifts as the need arises",
        "Annual recurring gifts",
        "Multi-year pledges (2-5 year commitment)",
        "Matching gifts through my employer",
        "Donor-advised fund (DAF) distributions",
        "A mix of approaches depending on the organization",
        "Other / Prefer not to say",
      ],
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "What elements of a capital campaign would make it compelling for you to support at a leadership level?",
      exportLabel: "Capital Campaign Appeal",
      required: false,
      clarify: true,
      useAI: false,
    },

    // ─── SECTION 8: FAMILY IMPACT & THE ASK (2Q) — Larry Kahn ───
    {
      id: generateId(),
      type: 'open',
      prompt: "Why does it matter to you if families are homeless here in Central Florida?",
      exportLabel: "Family Homelessness Importance",
      required: false,
      clarify: true,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "What would make you give $500 to build a new Children's and Women's Center and provide shelter, food, healthcare and safety for families in crisis?",
      exportLabel: "Capital Campaign Ask Response",
      required: false,
      clarify: true,
      useAI: false,
    },

    // ─── SECTION 9: OPEN-ENDED INSIGHTS (4Q) ───
    {
      id: generateId(),
      type: 'open',
      prompt: "Are there any misconceptions about the Coalition's work that, if addressed directly, would improve your confidence and increase your generosity?",
      exportLabel: "Misconceptions & Barriers",
      required: false,
      clarify: false,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "In your view, what distinguishes donors who become long-term supporters and advocates from those who give once and stop?",
      exportLabel: "Multi-Year Supporter Factors",
      required: false,
      clarify: false,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "What aspects of the Coalition's mission resonate most strongly with you personally, and why?",
      exportLabel: "Mission Resonance",
      required: false,
      clarify: true,
      useAI: false,
    },
    {
      id: generateId(),
      type: 'open',
      prompt: "What outcomes or milestones would give you confidence that your investment is driving meaningful, lasting change?",
      exportLabel: "Confidence Milestones",
      required: false,
      clarify: true,
      useAI: false,
    },
  ],

  // ──────────────────────────────────────────────────────────
  // PSYCHOGRAPHICS (Nonprofit Industry Questions)
  // Randomly show 3 per session for donor profiling
  // ──────────────────────────────────────────────────────────
  psychographicBank: [
    {
      key: 'i_np_involvement',
      q: 'How are you involved with the Coalition?',
      opts: ['Donor only', 'Volunteer', 'Both donor and volunteer', 'Event attendee', 'Program participant', 'Board / committee member', 'Staff', 'Other'],
      exportLabel: 'Involvement Type',
    },
    {
      key: 'i_np_tenure',
      q: 'How long have you been involved with the Coalition?',
      opts: ['Less than 1 year', '1–3 years', '3–5 years', 'Over 5 years'],
      exportLabel: 'Involvement Duration',
    },
  ],
  psychoCount: 2, // Show both nonprofit psycho questions
  customQCount: 0, // 0 = show all questions to every respondent (change to e.g. 18 to sample)

  // ──────────────────────────────────────────────────────────
  // DEMOGRAPHICS
  // Asking for basic location context (zip code)
  // ──────────────────────────────────────────────────────────
  demoFields: [
    {
      key: 'zip',
      label: 'ZIP / Postal Code',
      type: 'text',
      enabled: true,
    },
  ],

  // ──────────────────────────────────────────────────────────
  // CLARIFIERS & AI FOLLOW-UP
  // ──────────────────────────────────────────────────────────
  clarifiers: {
    default: 'Thank you for that feedback.',
  },
  useAIClarify: false, // Open-ended questions not using AI clarifiers

  // ──────────────────────────────────────────────────────────
  // THEME & BRANDING
  // Coalition brand colors
  // ──────────────────────────────────────────────────────────
  theme: {
    primaryColor: '#0F7173', // Coalition teal
    headerGradient: 'linear-gradient(135deg, #0F7173 0%, #1DA39A 100%)',
    backgroundColor: '#f8f9fa',
    accentColor: '#E8B84B', // Gold accent
    botAvatarGradient: 'linear-gradient(135deg, #0F7173 0%, #1DA39A 100%)',
  },

  brandingLabel: 'COALITION',
  showBranding: true,

  // ──────────────────────────────────────────────────────────
  // RESPONSE CONTROL
  // ──────────────────────────────────────────────────────────
  allowMultipleResponses: false, // One response per device/session
}

/**
 * STUDY METADATA
 * Use this when creating the Study record in Supabase
 */
export const coalitionStudyMetadata = {
  name: 'Coalition for the Homeless — Donor Insights Study',
  description: 'Comprehensive donor study capturing awareness, motivation, retention, growth, capital campaign readiness, and legacy giving. Based on stakeholder interviews with CEO, corporate partners, legal advisors, and board members.',
  botName: 'Coalition Insights Bot',
  botEmoji: '🤝',
  industry: 'nonprofit',
}

export default coalitionDonorStudyConfig
