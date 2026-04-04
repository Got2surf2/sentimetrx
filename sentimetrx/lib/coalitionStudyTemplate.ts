// lib/coalitionStudyTemplate.ts
// Coalition for the Homeless — Donor Study Configuration
// Complete study template ready to deploy
// Created from stakeholder questions mapping: Brad Butterstein (CEO), Craig Fairey (Wells Fargo),
// Liza Coburn (TRUIST), Jim Schreiber (Attorney)

import { StudyConfig } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'

/**
 * COALITION FOR THE HOMELESS — DONOR INSIGHT STUDY
 *
 * Survey Structure:
 * - 19 total questions
 * - 17 categorical/likert (multiple choice, scales, multi-select)
 * - 2 open-ended (capture nuance + strategic insights)
 * - 2 demographic (involvement, tenure)
 *
 * Completion time: ~7-10 minutes
 * Focus: Donor motivation, retention, growth, & legacy giving
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
  // CUSTOM QUESTIONS (17 total)
  // Organized in 6 sections:
  // 1. Giving Profile & Mindset (3Q)
  // 2. Motivation & Values (3Q)
  // 3. Communication & Recognition (3Q)
  // 4. Engagement & Involvement (2Q)
  // 5. Retention & Growth (2Q)
  // 6. Legacy & Strategic Giving (2Q)
  // + 2 Open-Ended Insights
  // ──────────────────────────────────────────────────────────

  questions: [
    // ─── SECTION 1: GIVING PROFILE & MINDSET (3Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 2: MOTIVATION & VALUES (3Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 3: COMMUNICATION & RECOGNITION (3Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 4: ENGAGEMENT & INVOLVEMENT (2Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 5: RETENTION & GROWTH (2Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 6: LEGACY & STRATEGIC GIVING (2Q) ───
    {
      id: uuidv4(),
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
      id: uuidv4(),
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

    // ─── SECTION 7: OPEN-ENDED INSIGHTS (2Q) ───
    {
      id: uuidv4(),
      type: 'open',
      prompt: "Are there any misconceptions about the Coalition's work that, if addressed directly, would improve your confidence and increase your generosity?",
      exportLabel: "Misconceptions & Barriers",
      required: false,
      clarify: false,
      useAI: false,
    },
    {
      id: uuidv4(),
      type: 'open',
      prompt: "In your view, what distinguishes donors who become long-term supporters and advocates from those who give once and stop?",
      exportLabel: "Multi-Year Supporter Factors",
      required: false,
      clarify: false,
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
  description: 'Comprehensive donor study capturing motivation, retention, growth, and legacy giving. Based on stakeholder interviews with CEO, corporate partners, and legal advisors.',
  botName: 'Coalition Insights Bot',
  botEmoji: '🤝',
  industry: 'nonprofit',
}

export default coalitionDonorStudyConfig
