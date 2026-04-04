// lib/smartStudyGenerator.ts
// Smart Study Builder — generates complete StudyDraft from wizard answers
// Uses survey blueprints to configure opening patterns (rating-first vs open-first)

import type { StudyDraft } from './studyDraft'
import type { StudyConfig, SurveyQuestion, LikertScaleOption } from './types'
import type { Industry } from './industryDefaults'
import type { StudyType } from './surveyBlueprints'
import { INDUSTRY_DEFAULTS, INDUSTRY_SUGGESTED_QUESTIONS, INDUSTRY_LABELS } from './industryDefaults'
import { getBlueprintForStudyType } from './surveyBlueprints'

export interface WizardAnswers {
  industry:    Industry
  studyType:   StudyType
  focusAreas:  string[]        // e.g., ['retention', 'communication', 'legacy_giving']
  length:      'quick' | 'standard' | 'comprehensive'
  openEnded:   0 | 1 | 2
  botName:     string          // user-customized bot name
  botEmoji:    string          // user-selected emoji
}

// ─────────────────────────────────────────────────────────────
// FOCUS AREA QUESTIONS — mapped to survey questions
// ─────────────────────────────────────────────────────────────

function createSurveyQuestion(
  id: string,
  type: any,
  prompt: string,
  options?: any[],
  exportLabel?: string,
  likertScale?: LikertScaleOption[]
): SurveyQuestion {
  const q: any = { id, type, prompt, exportLabel: exportLabel || prompt }
  if (options) q.options = options
  if (likertScale) q.likertScale = likertScale
  return q as SurveyQuestion
}

const LIKERT_5_IMPORTANT: LikertScaleOption[] = [
  { score: 1, label: 'Not important' },
  { score: 2, label: 'Somewhat important' },
  { score: 3, label: 'Moderately important' },
  { score: 4, label: 'Very important' },
  { score: 5, label: 'Extremely important' },
]

const FOCUS_AREA_QUESTIONS: Record<string, SurveyQuestion[]> = {
  retention: [
    createSurveyQuestion('ret_1', 'checkbox', 'What would cause you to stop engaging with us?', [
      'Lack of results or impact',
      'Poor communication',
      'Better alternatives available',
      'Cost or financial constraints',
      'Loss of trust',
      'Changes in direction or values',
    ], 'Churn Factors'),
    createSurveyQuestion('ret_2', 'checkbox', 'What would motivate you to increase your support?', [
      'Evidence of impact',
      'Personal request from leadership',
      'New or expanded programs',
      'Matching grants or incentives',
      'Volunteer opportunity first',
      'Seeing specific unmet needs',
    ], 'Growth Triggers'),
  ],
  communication: [
    createSurveyQuestion('com_1', 'checkbox', 'How would you prefer to receive updates?', [
      'Email newsletter',
      'Text message alerts',
      'Social media',
      'Phone call',
      'In-person meeting',
      'Physical mail',
      'Minimal contact',
    ], 'Communication Methods'),
    createSurveyQuestion('com_2', 'radio', 'How often should we contact you?', [
      'Monthly or more',
      'Quarterly',
      'Semi-annually',
      'Annually',
      'As-needed only',
      'Prefer not to receive updates',
    ], 'Communication Frequency'),
  ],
  recognition: [
    createSurveyQuestion('rec_1', 'radio', 'How would you like to be recognized?', [
      'Hand-written note from leadership',
      'Personal phone call',
      'Email acknowledgement',
      'Public recognition',
      'No special recognition needed',
      'Other',
    ], 'Recognition Preference'),
  ],
  motivation: [
    createSurveyQuestion('mot_1', 'radio', 'What drives your engagement most?', [
      'Personal connection to mission',
      'Trust in leadership',
      'Measurable impact and results',
      'Community and relationships',
      'Alignment with my values',
      'Tax or financial benefits',
    ], 'Primary Motivation'),
    createSurveyQuestion('mot_2', 'likert', 'How important is evidence of impact when you decide to give or engage?', undefined, 'Impact Importance', LIKERT_5_IMPORTANT),
  ],
  legacy_giving: [
    createSurveyQuestion('leg_1', 'radio', 'Have you considered a bequest or planned gift?', [
      'Yes, very interested',
      'Possibly, open to discussion',
      'Already included in my will',
      'No, prefer other giving methods',
      'Unsure / haven\'t thought about it',
    ], 'Bequest Interest'),
    createSurveyQuestion('leg_2', 'radio', 'Which giving option appeals to you most?', [
      'Current operating support',
      'Endowment or long-term fund',
      'Specific program or initiative',
      'Building or facility',
      'Planned gift or bequest',
      'Other',
    ], 'Preferred Giving Vehicle'),
  ],
  civic_mindset: [
    createSurveyQuestion('civ_1', 'radio', 'How critical is this issue in our community?', [
      'Critical — urgent action needed',
      'Serious — needs attention',
      'Moderate concern',
      'Minor concern',
      'Not a priority',
    ], 'Issue Perception'),
    createSurveyQuestion('civ_2', 'radio', 'Who should primarily address this issue?', [
      'Government',
      'Private business',
      'Nonprofit organizations',
      'Individual citizens',
      'All equally',
    ], 'Responsibility View'),
  ],
  donor_capacity: [
    createSurveyQuestion('cap_1', 'radio', 'How do you typically approach giving?', [
      'Structured / planned gifts',
      'Discretionary / when funds available',
      'Mix of both',
      'Event or campaign-based',
      'Other',
    ], 'Giving Pattern'),
    createSurveyQuestion('cap_2', 'radio', 'Which describes your giving capacity?', [
      'Modest — small gifts when able',
      'Moderate — regular planned gifts',
      'Major — significant annual support',
      'Transformational — major gifts',
      'Prefer not to say',
    ], 'Donor Capacity'),
  ],
  satisfaction: [
    createSurveyQuestion('sat_1', 'likert', 'How satisfied are you overall?', undefined, 'Overall Satisfaction', [
      { score: 1, label: 'Very unsatisfied' },
      { score: 2, label: 'Unsatisfied' },
      { score: 3, label: 'Neutral' },
      { score: 4, label: 'Satisfied' },
      { score: 5, label: 'Very satisfied' },
    ]),
  ],
  loyalty: [
    createSurveyQuestion('loy_1', 'radio', 'How long have you been with us?', [
      'Less than 1 year',
      '1-3 years',
      '3-5 years',
      'Over 5 years',
    ], 'Tenure'),
    createSurveyQuestion('loy_2', 'radio', 'How often do you engage with us?', [
      'Once',
      'Occasionally',
      'Regularly',
      'Frequently',
      'Very frequently',
    ], 'Engagement Frequency'),
  ],
  engagement: [
    createSurveyQuestion('eng_1', 'radio', 'Are you interested in deeper engagement?', [
      'Yes — definitely interested',
      'Yes — possibly',
      'No — prefer current level',
      'No — not interested',
      'Already highly engaged',
    ], 'Engagement Interest'),
    createSurveyQuestion('eng_2', 'radio', 'What aspect resonates most with you?', [
      'Direct impact on people',
      'Systemic change',
      'Community building',
      'Skill-based contribution',
      'Financial support',
      'Other',
    ], 'Value Resonance'),
  ],
}

// ─────────────────────────────────────────────────────────────
// MAIN GENERATOR
// ─────────────────────────────────────────────────────────────

let questionIdCounter = 0
function nextQId(): string {
  return 'q_' + (++questionIdCounter)
}

export function generateStudyDraft(answers: WizardAnswers): StudyDraft {
  questionIdCounter = 0

  // Get blueprint for the selected study type
  const blueprint = getBlueprintForStudyType(answers.studyType)

  // Start with industry defaults (or fallback for 'other')
  let config: StudyConfig

  if (answers.industry === 'other') {
    config = {
      greeting: "Hi! I'd love to gather your feedback. Your input helps us improve.",
      ratingPrompt: "How would you rate your overall experience with us?",
      promoterQ1: "That's great! What stood out most?",
      passiveQ1: "Thank you. What could we improve?",
      detractorQ1: "I'm sorry to hear that. What fell short?",
      q3: "Is there anything else you'd like us to know?",
      q3Enabled: answers.openEnded >= 1,
      q4: "Any final thoughts?",
      q4Enabled: answers.openEnded === 2,
      clarifiers: { default: "Could you tell me a bit more about that?" },
      psychographicBank: [],
      industry: 'other',
      ratingScale: [
        { emoji: '😞', label: 'Very poor', score: 1 },
        { emoji: '😕', label: 'Poor', score: 2 },
        { emoji: '😐', label: 'Okay', score: 3 },
        { emoji: '😊', label: 'Good', score: 4 },
        { emoji: '😍', label: 'Excellent', score: 5 },
      ],
      theme: {
        primaryColor: '#00b4d8',
        headerGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
        backgroundColor: '#0a1628',
        accentColor: '#00d4ff',
        botAvatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
      },
      questions: [],
    } as any
  } else {
    const defaults = INDUSTRY_DEFAULTS[answers.industry]
    config = {
      ...defaults,
      industry: answers.industry,
      q3Enabled: answers.openEnded >= 1,
      q4Enabled: answers.openEnded === 2,
      questions: [],
      clarifiers: { ...defaults.clarifiers },
      ratingScale: [
        { emoji: '😞', label: 'Very poor', score: 1 },
        { emoji: '😕', label: 'Poor', score: 2 },
        { emoji: '😐', label: 'Okay', score: 3 },
        { emoji: '😊', label: 'Good', score: 4 },
        { emoji: '😍', label: 'Excellent', score: 5 },
      ],
      theme: {
        primaryColor: '#00b4d8',
        headerGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
        backgroundColor: '#0a1628',
        accentColor: '#00d4ff',
        botAvatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
      },
    } as any
  }

  // Apply blueprint opening pattern
  config.experienceEnabled = blueprint.enableExperienceRating
  config.npsEnabled = blueprint.enableNPS
  config.studyType = answers.studyType
  config.templateLabel = blueprint.templateLabel

  // Get suggested questions for this industry (up to 2)
  const suggestedQuestions = answers.industry === 'other'
    ? []
    : INDUSTRY_SUGGESTED_QUESTIONS[answers.industry] || []

  // Add suggested questions
  const customQuestions: SurveyQuestion[] = []
  const maxSuggested = 2
  for (let i = 0; i < Math.min(maxSuggested, suggestedQuestions.length); i++) {
    const sq = suggestedQuestions[i]
    customQuestions.push(
      createSurveyQuestion(
        nextQId(),
        'radio',
        sq.q,
        sq.opts,
        sq.exportLabel || sq.q
      )
    )
  }

  // Add focus area questions
  const focusAreaQuestions: SurveyQuestion[] = []
  for (const focusArea of answers.focusAreas) {
    const areaQs = FOCUS_AREA_QUESTIONS[focusArea] || []
    focusAreaQuestions.push(
      ...areaQs.map(q => ({
        ...q,
        id: nextQId(),
      }))
    )
  }

  // Target question counts by length
  const target = blueprint.questionCounts[answers.length]
  const totalCustomQuestions = customQuestions.length + focusAreaQuestions.length

  let questionsToAdd: SurveyQuestion[] = []
  if (totalCustomQuestions <= target) {
    questionsToAdd = [...customQuestions, ...focusAreaQuestions]
  } else {
    questionsToAdd = [...customQuestions]
    const remaining = target - customQuestions.length
    questionsToAdd.push(...focusAreaQuestions.slice(0, remaining))
  }

  // For open-first studies: prepend an open-ended question
  if (!blueprint.enableExperienceRating && !blueprint.enableNPS) {
    const openEndedQuestion: SurveyQuestion = {
      id: nextQId(),
      type: 'open',
      prompt: 'What comes to mind when you think about us?',
      exportLabel: 'Unaided Awareness',
      clarify: false,
      useAI: false,
    }
    questionsToAdd.unshift(openEndedQuestion)
  }

  config.questions = questionsToAdd

  // Auto-generate name and bot info
  const industryLabel = INDUSTRY_LABELS[answers.industry] || answers.industry

  return {
    name: `${blueprint.label} Study`,
    bot_name: answers.botName,
    bot_emoji: answers.botEmoji,
    config,
    industry: answers.industry,
  }
}
